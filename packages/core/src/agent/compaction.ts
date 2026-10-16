import { asId, isJsonObject } from "@nyte-ai/schema";
import type {
  CommitId,
  CompactionPlan,
  Configuration,
  DurableEvent,
  Failure,
  HeadName,
  Json,
  ModelInfo,
  ModelRef,
  PartId,
  Placement,
  RefUpdate,
  RunId,
  RunView,
  SessionId,
  Transcript,
  Usage,
} from "@nyte-ai/schema";
import { contentText } from "@nyte-ai/schema/model";
import type {
  Api,
  JsonValue,
  Message,
  Model,
  ProviderCheckpointMaterial,
} from "@nyte-ai/schema/model";
import type { Models } from "@nyte-ai/ai";
import { estimateMessageTokens } from "@nyte-ai/ai/utils/estimate";
import { LOCAL } from "../contract/host.ts";
import type {
  Compactor,
  HookContext,
  Kernel,
  PluginRuntime,
  Summarizer,
} from "../contract/kernel.ts";
import { compaction } from "../contract/parts.ts";
import { decodePartRecord, decodeRunRecord } from "../contract/records.ts";
import type { PartRecord } from "../contract/records.ts";
import { collectContributions } from "../engine/contributions.ts";
import { modelInfo } from "../extend/models.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { failedParts, settling } from "../store/parts.ts";
import { headRef, partRef, runRef, sessionRef } from "../store/refs.ts";
import {
  attempt,
  load,
  put,
  readPositionCommit,
  readRefExpectation,
  readTip,
  requireSession,
  STALE,
  START,
  toCommitObjectId,
  walkCommitPath,
} from "../store/session.ts";
import type { Tip } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { SdkError } from "../util/error.ts";
import { check } from "../util/json-schema.ts";
import { extractUserText } from "../util/text.ts";
import { charge, complete, requestEvent, rideRef, ZERO_USAGE } from "./request.ts";
import { estimateTranscriptTokens, projectedCommit, requestBody } from "./transcript.ts";
import type { StoreConnection } from "../contract/store.ts";

type Answer =
  | { readonly kind: "ok"; readonly text: string; readonly usage: Usage; readonly info: ModelInfo }
  | { readonly kind: "failed"; readonly failure: Failure };

type Written =
  | {
      readonly kind: "ok";
      readonly state: Json;
      readonly usage: Usage | null;
      readonly event: DurableEvent | null;
    }
  | { readonly kind: "failed"; readonly failure: Failure };

interface Opened {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly run: RunId | null;
  readonly part: PartId;
  /** The head's tip when the compaction opened: what its summary read. */
  readonly tip: CommitId | null;
  readonly info: ModelInfo;
  readonly plan: CompactionPlan;
}

const NOTE: Placement = { kind: "transcript", role: "note" };

const MOVED: Failure = {
  class: "runner",
  message: "The head left the summarised history while the compaction ran; nothing was compacted.",
};

const STOPPED: Failure = { class: "aborted", message: "The run was stopped." };

const ORPHANED: Failure = {
  class: "runner",
  message: "The host stopped while this compaction ran.",
};

const RESULT_LIMIT = 2_000;

const running = new WeakMap<Kernel, Set<PartId>>();

const COMPACTION_SYSTEM =
  "You summarise a coding agent's conversation so that another model can continue it from the summary alone.";

const BRANCH_SYSTEM =
  "You summarise an abandoned branch of a coding agent's conversation so that the conversation can continue without it.";

async function latestCompaction(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Json | null> {
  return withFold(kernel, session, (state) => {
    const path = walkCommitPath(
      state.commits,
      readPositionCommit(state.heads.get(head)?.info.tip ?? START),
    );

    for (const id of [...path].reverse()) {
      const body = state.commits.get(id)?.body;

      if (body?.kind === "compaction") return state.parts.get(body.part)?.state ?? null;
    }

    return null;
  });
}

export function createCompactor(kernel: Kernel, models: Models): Compactor {
  return async ({ session, head, instructions }) => {
    const runtime = kernel.pluginsFor(session);
    const configuration = await resolveHeadConfiguration(kernel, runtime, session, head);
    const { model } = configuration;
    const info = modelInfo(models, model, runtime);

    if (info === null)
      throw new SdkError("invalid", `No model ${model.provider}/${model.id} is in the catalog.`);
    const body = { session, head, run: null, configuration };
    const { transcript } = await requestBody(kernel, models, runtime, body);
    await failLeftoverCompactions(kernel, session, head, null);

    const opened = await openCompaction(kernel, {
      session,
      head,
      run: null,
      model,
      info,
      transcript,
      reason: "manual",
      instructions,
      tokensBefore: estimateTranscriptTokens(transcript),
    });

    if (opened === null) return { kind: "nothing-to-compact" };

    if (opened === "stopped")
      throw new SdkError("internal", "A manual compaction has no run to stop.");
    const here = running.get(kernel) ?? new Set<PartId>();
    running.set(kernel, here.add(opened.part));

    void finishCompaction(kernel, models, runtime, opened, kernel.executionState.closing.signal)
      .catch((error) =>
        dev("compaction", "failed", {
          session,
          part: opened.part,
          error: formatErrorMessage(error),
        }),
      )
      .finally(() => here.delete(opened.part));

    return { kind: "started", message: asId<"message">(opened.part) };
  };
}

/** Compacts a run's transcript before its next request, through the same live part a manual compaction shows. */
export async function compact(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunView;
    readonly configuration: Configuration;
    readonly transcript: Transcript;
    readonly info: ModelInfo;
    readonly reason: "threshold" | "overflow";
    readonly signal: AbortSignal;
  },
): Promise<
  | { readonly kind: "compacted" }
  | { readonly kind: "skipped" }
  | { readonly kind: "failed"; readonly failure: Failure }
> {
  const { session, head, run } = input;
  const tokensBefore = estimateTranscriptTokens(input.transcript);
  dev("compaction", input.reason, { session, run: run.id, tokensBefore, at: input.info.compactAt });

  const opened = await openCompaction(kernel, {
    session,
    head,
    run: run.id,
    model: input.configuration.model,
    info: input.info,
    transcript: input.transcript,
    reason: input.reason,
    instructions: null,
    tokensBefore,
  });

  if (opened === null) return { kind: "skipped" };

  if (opened === "stopped") return { kind: "failed", failure: STOPPED };

  return finishCompaction(kernel, models, runtime, opened, input.signal);
}

export function createSummarizer(kernel: Kernel, models: Models): Summarizer {
  return async ({ session, head, commits, instructions, signal }) => {
    if (commits.length === 0) return { kind: "ok", markdown: "", usage: ZERO_USAGE };

    try {
      const runtime = kernel.pluginsFor(session);
      const configuration = await resolveHeadConfiguration(kernel, runtime, session, head);

      const lines = await withFold(kernel, session, (state) =>
        commits.flatMap((id): readonly string[] => {
          const body = state.commits.get(id)?.body;

          if (body === undefined) return [];

          if (body.kind === "user") return [`User: ${extractUserText(body.content)}`];
          const part = state.parts.get(body.part);

          return part === undefined ? [] : [renderCompactionPart(kernel, part)];
        }),
      );

      const answer = await ask(kernel, models, runtime, {
        where: { session, head, run: null, principal: LOCAL },
        model: configuration.model,
        step: "summary",
        system: BRANCH_SYSTEM,
        prompt: [
          `<branch>\n${lines.join("\n\n")}\n</branch>`,
          "Write a short markdown summary of what this abandoned path tried and what it found.",
          ...(instructions === null ? [] : [`Follow these instructions: ${instructions}`]),
        ].join("\n\n"),
        signal,
      });

      if (answer.kind === "failed") return { kind: "failed", reason: answer.failure.message };

      await rideRef(
        kernel,
        sessionRef(session),
        requestEvent(head, "summary", answer.usage, answer.info),
      );

      return { kind: "ok", markdown: answer.text, usage: answer.usage };
    } catch (error) {
      return { kind: "failed", reason: formatErrorMessage(error) };
    }
  };
}

/** Opens the compaction's live part, so every client shows it while the summary is written; `stopped` when the run it compacts for was stopped. */
async function openCompaction(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly model: ModelRef;
    readonly info: ModelInfo;
    readonly transcript: Transcript;
    readonly reason: CompactionPlan["reason"];
    readonly instructions: string | null;
    readonly tokensBefore: number;
  },
): Promise<Opened | "stopped" | null> {
  const split = splitTranscriptForCompaction(input.transcript, input.info);

  if (split === null) return null;
  const { session, head, run, tokensBefore } = input;
  const tip = await readTip(kernel.store, session, head);
  const part = asId<"part">(crypto.randomUUID());
  const state: Json = { summary: null, material: null, tokensBefore, usage: null };

  const record: PartRecord = {
    id: part,
    partKind: "compaction",
    placement: NOTE,
    state,
    version: 1,
    owner: null,
    run,
    status: { kind: "live", run },
  };

  const target = await put(kernel.store, "part", record);

  const opened = await commit(
    kernel,
    [
      {
        name: partRef(session, part),
        target,
        expect: "absent",
        events: [
          {
            head,
            kind: "part",
            part,
            change: "created",
            partKind: "compaction",
            placement: NOTE,
            state,
            version: 1,
            run,
            owner: null,
          },
        ],
      },
    ],
    run === null ? null : { session, run },
  );

  if (opened.kind !== "set") return "stopped";

  return {
    session,
    head,
    run,
    part,
    tip: tip.id,
    info: input.info,
    plan: {
      model: input.model,
      reason: input.reason,
      instructions: input.instructions,
      tokensBefore,
      summarise: split.summarise,
      keep: split.keep,
      result: null,
    },
  };
}

/** Writes the summary of an opened compaction and lands it on the head, or fails its part with the reason. */
async function finishCompaction(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  opened: Opened,
  signal: AbortSignal,
): Promise<
  { readonly kind: "compacted" } | { readonly kind: "failed"; readonly failure: Failure }
> {
  const { session, head, run, part } = opened;
  const where = { session, head, run, principal: LOCAL };
  let failure: Failure;

  try {
    const plan = await runtime.hooks.transform("before_compaction", opened.plan, where, signal);

    const written = await buildCompactionResult(kernel, models, runtime, {
      where,
      plan,
      info: opened.info,
      signal,
    });

    if (written.kind === "ok") {
      const landed = await attempt(`Compacting ${head}`, async () => {
        const outcome = await writeCompaction(kernel, { ...opened, plan, written });

        return outcome === "stale" ? STALE : outcome;
      });

      if (landed === "set") {
        dev("compaction", "compacted", { session, run, part });

        return { kind: "compacted" };
      }

      return { kind: "failed", failure: landed };
    }

    failure = written.failure;
  } catch (error) {
    failure = { class: "runner", message: formatErrorMessage(error) };
  }

  await attempt(`Failing compaction ${part}`, async () => {
    const updates = await failedParts(kernel.store, session, head, [part], failure);

    return updates.length === 0 || (await commit(kernel, updates)).kind === "set"
      ? undefined
      : STALE;
  });

  return { kind: "failed", failure };
}

/** Fails compaction parts no process is writing: a run's own, left live by a host that stopped, and manual ones this process did not start. */
export async function failLeftoverCompactions(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId | null,
): Promise<void> {
  const here = running.get(kernel);

  const leftover = await withFold(kernel, session, (state) =>
    [...state.parts.values()].flatMap((part) =>
      part.partKind === "compaction" &&
      part.status.kind === "live" &&
      ((run !== null && part.run === run) || (part.run === null && here?.has(part.id) !== true))
        ? [part.id]
        : [],
    ),
  );

  if (leftover.length === 0) return;

  await attempt(`Failing compactions ${leftover.join(", ")}`, async () => {
    const updates = await failedParts(kernel.store, session, head, leftover, ORPHANED);

    return updates.length === 0 || (await commit(kernel, updates)).kind === "set"
      ? undefined
      : STALE;
  });
}

/** Lands a written compaction: its part settles and its commit replaces what it summarised. When the part was stopped or the head left the summarised history, the part fails instead; the summary's request is charged either way. */
async function writeCompaction(
  kernel: Kernel,
  input: Opened & {
    readonly plan: CompactionPlan;
    readonly written: Extract<Written, { readonly kind: "ok" }>;
  },
): Promise<"set" | "stale" | Failure> {
  const { session, head, run, part, written } = input;
  const { state } = written;
  const name = partRef(session, part);

  const [live, tip, fence] = await Promise.all([
    kernel.store.refs.get(name).then((ref) => load(kernel.store, ref, decodePartRecord)),
    readTip(kernel.store, session, head),
    run === null ? null : chargeRun(kernel.store, session, run, written),
  ]);

  const replaces =
    live?.record.status.kind === "live" && fence?.stopping !== true
      ? await findReplacedCommits(kernel, session, input.tip, tip, input.plan)
      : null;

  if (live === null || replaces === null) {
    const failure =
      live?.record.status.kind === "live" && fence?.stopping !== true ? MOVED : STOPPED;

    const outcome = await commit(kernel, [
      ...(await failedParts(kernel.store, session, head, [part], failure)),
      ...(fence === null
        ? []
        : [{ ...fence.update, events: written.event === null ? [] : [written.event] }]),
    ]);

    if (outcome.kind === "stale") return "stale";

    if (fence === null && written.event !== null)
      await rideRef(kernel, sessionRef(session), written.event);

    return failure;
  }

  const at = Date.now();
  const version = live.record.version + 1;

  const landed = await settling(kernel.store, {
    session,
    head,
    run,
    parent: tip.id,
    expect: readRefExpectation(tip.ref),
    record: { ...live.record, state, version },
    revision: live.ref.revision,
    logged: [
      { head, kind: "part", part, change: "updated", state, version },
      ...(written.event === null ? [] : [written.event]),
    ],
    body: { kind: "compaction", part, replaces },
    at,
  });

  const outcome = await commit(kernel, [
    ...landed.updates,
    ...(run === null
      ? [
          {
            name: headRef(session, head),
            target: toCommitObjectId(landed.landed),
            events: [
              {
                head,
                kind: "head",
                from: tip.id,
                to: landed.landed,
                reason: "moved",
              } as const,
            ],
          },
        ]
      : []),
    ...(fence === null ? [] : [fence.update]),
  ]);

  return outcome.kind === "set" ? "set" : "stale";
}

async function chargeRun(
  store: StoreConnection,
  session: SessionId,
  run: RunId,
  written: Extract<Written, { readonly kind: "ok" }>,
): Promise<{ readonly update: RefUpdate; readonly stopping: boolean }> {
  const { usage, event } = written;
  const name = runRef(session, run);
  const found = await load(store, await store.refs.get(name), decodeRunRecord);

  if (found === null) throw new SdkError("internal", `Run ${run} has no record.`);

  return {
    update: {
      name,
      target: await put(store, "run", charge(found.record, usage, event !== null)),
      expect: found.ref.revision,
    },
    stopping: found.record.stopping,
  };
}

async function buildCompactionResult(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  input: {
    readonly where: HookContext & { readonly head: HeadName };
    readonly plan: CompactionPlan;
    readonly info: ModelInfo;
    readonly signal: AbortSignal;
  },
): Promise<Written> {
  const { plan, where } = input;
  const result = plan.result;

  if (result !== null) {
    const usage = result.kind === "material" ? result.usage : null;

    const state: Json = {
      summary: result.kind === "summary" ? result.text : null,
      material:
        result.kind === "material"
          ? { provider: result.provider, api: result.api, model: result.model, data: result.data }
          : null,
      tokensBefore: plan.tokensBefore,
      usage,
    };

    const checked = await check(compaction.state, state);

    if (checked.kind === "invalid")
      return {
        kind: "failed",
        failure: {
          class: "runner",
          message: `before_compaction returned an invalid result: ${checked.issues.map((issue) => issue.message).join("; ")}`,
        },
      };

    return {
      kind: "ok",
      state,
      usage,
      event: usage === null ? null : requestEvent(where.head, "compaction", usage, input.info),
    };
  }

  const answer = await ask(kernel, models, runtime, {
    where,
    model: plan.model,
    step: "compaction",
    system: COMPACTION_SYSTEM,
    prompt: [
      `<conversation>\n${transcriptText(plan.summarise)}\n</conversation>`,
      "Summarise the conversation above for the model that continues it: the user's goals and instructions, what was done and found, the files involved, the decisions made, and what remains to do. Be specific and brief.",
      ...(plan.instructions === null ? [] : [`Follow these instructions: ${plan.instructions}`]),
    ].join("\n\n"),
    signal: input.signal,
  });

  if (answer.kind === "failed") return answer;

  return {
    kind: "ok",
    state: {
      summary: answer.text,
      material: null,
      tokensBefore: plan.tokensBefore,
      usage: answer.usage,
    },
    usage: answer.usage,
    event: requestEvent(where.head, "compaction", answer.usage, answer.info),
  };
}

async function ask(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  input: {
    readonly where: HookContext;
    readonly model: ModelRef;
    readonly step: "compaction" | "summary";
    readonly system: string;
    readonly prompt: string;
    readonly signal: AbortSignal;
  },
): Promise<Answer> {
  const { where, step } = input;

  const request = await runtime.hooks.transform(
    "before_request",
    {
      model: input.model,
      thinking: "off",
      step,
      attempt: 1,
      options: { sampling: {}, headers: {} },
    },
    where,
    input.signal,
  );

  const sent = await complete(kernel, models, runtime, {
    where,
    step,
    request,
    system: input.system,
    messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
    signal: input.signal,
  });

  if (sent === null)
    return {
      kind: "failed",
      failure: {
        class: "runner",
        message: `No model ${request.model.provider}/${request.model.id} is in the catalog.`,
      },
    };

  const { message, usage, info, failure } = sent;

  if (failure !== null) return { kind: "failed", failure };
  const answer = contentText(message.content).trim();

  if (answer === "")
    return {
      kind: "failed",
      failure: { class: "provider", message: "The summary came back empty." },
    };

  return { kind: "ok", text: answer, usage, info };
}

function splitTranscriptForCompaction(
  transcript: Transcript,
  info: ModelInfo,
): { readonly summarise: readonly Message[]; readonly keep: readonly Message[] } | null {
  const body =
    transcript.messages[0]?.role === "system" ? transcript.messages.slice(1) : transcript.messages;

  const budget = info.contextWindow / 5;
  const sizes = body.map((message) => estimateMessageTokens(message));
  const tail = (from: number): number => sizes.slice(from).reduce((sum, size) => sum + size, 0);
  const latest = body.findLastIndex((message) => message.role === "user");
  let start = body.length;

  if (latest >= 0 && tail(latest) <= budget) start = latest;
  else while (start > 0 && tail(start - 1) <= budget) start -= 1;

  while (start < body.length && body[start]?.role === "toolResult") start += 1;
  const summarise = body.slice(0, start);

  if (!summarise.some((message) => projectedCommit(message) !== null)) return null;

  return { summarise, keep: body.slice(start) };
}

/** The commits a compaction replaces on the head's current path, or null once the head no longer holds a summarised commit it held when the compaction opened. */
async function findReplacedCommits(
  kernel: Kernel,
  session: SessionId,
  opened: CommitId | null,
  tip: Tip,
  plan: CompactionPlan,
): Promise<readonly CommitId[] | null> {
  const [before, path] = await withFold(kernel, session, (state) => [
    new Set(walkCommitPath(state.commits, opened)),
    walkCommitPath(state.commits, tip.id),
  ]);

  const positions = new Map(path.map((commit, index) => [commit, index]));

  const indexes = (messages: readonly Message[]): readonly number[] =>
    messages.flatMap((message) => {
      const commit = projectedCommit(message);
      const index = commit === null ? undefined : positions.get(commit);

      return index === undefined ? [] : [index];
    });

  const left = plan.summarise.some((message) => {
    const commit = projectedCommit(message);

    return commit !== null && before.has(commit) && !positions.has(commit);
  });

  if (left) return null;
  const kept = indexes(plan.keep);
  const summarised = indexes(plan.summarise);

  if (kept.length === 0)
    return summarised.length === 0 ? [] : path.slice(0, Math.max(...summarised) + 1);
  const older = path.slice(0, Math.min(...kept));

  return [
    ...older,
    ...summarised.flatMap((index) => (older.includes(path[index]) ? [] : [path[index]])),
  ];
}

async function resolveHeadConfiguration(
  kernel: Kernel,
  runtime: PluginRuntime,
  session: SessionId,
  head: HeadName,
): Promise<Configuration> {
  const found = await requireSession(kernel.store, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  await runtime.ready;

  const resolved = await kernel.resolveConfiguration({
    session,
    head,
    selected: entry.selected,
    patch: null,
    contributions: collectContributions(runtime),
  });

  if (resolved.kind !== "exact")
    throw new SdkError("invalid", `The head's configuration is ${resolved.kind}.`);

  return resolved;
}

function transcriptText(messages: readonly Message[]): string {
  return messages
    .flatMap((message): readonly string[] => {
      switch (message.role) {
        case "system":
          return [];
        case "user":
          return [`User: ${contentText(message.content)}`];
        case "assistant":
          return message.content.flatMap((block) =>
            block.type === "text"
              ? [`Assistant: ${block.text}`]
              : block.type === "toolCall"
                ? [`Assistant called ${block.name}(${JSON.stringify(block.arguments)})`]
                : [],
          );
        case "toolResult":
          return [
            `${message.toolName} ${message.isError ? "failed" : "returned"}: ${elideMiddle(contentText(message.content))}`,
          ];
      }
    })
    .join("\n\n");
}

/** Keeps a long tool result's start and its end, where a command prints its outcome, and marks what was cut between. */
function elideMiddle(text: string): string {
  if (text.length <= RESULT_LIMIT) return text;
  const half = RESULT_LIMIT / 2;

  return `${text.slice(0, half)}\n[… ${text.length - RESULT_LIMIT} characters omitted …]\n${text.slice(-half)}`;
}

function renderCompactionPart(kernel: Kernel, part: PartRecord): string {
  const state = part.state;

  if (part.partKind === "text" && isJsonObject(state) && typeof state.markdown === "string")
    return `Assistant: ${state.markdown}`;

  if (part.partKind === "tool" && isJsonObject(state) && typeof state.name === "string") {
    const outcome = isJsonObject(state.outcome) ? state.outcome.kind : state.phase;

    return `Tool ${state.name}(${JSON.stringify(state.args ?? null)}) → ${typeof outcome === "string" ? outcome : "unsettled"}`;
  }

  return (
    kernel.partDefinitions.get(part.partKind)?.definition.fallback(state, { id: part.id }) ?? ""
  );
}

function formatErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function readProviderCheckpoint(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  model: Model<Api>,
): Promise<ProviderCheckpointMaterial | null> {
  const latest = await latestCompaction(kernel, session, head);

  if (latest === null) return null;
  const checked = await check(compaction.state, latest);

  if (checked.kind === "invalid")
    throw new SdkError("internal", "The head's latest compaction is corrupt in the store.");
  const material = checked.value.material;

  if (
    material === null ||
    material.provider !== model.provider ||
    material.api !== model.api ||
    material.model !== (model.variant?.base ?? model.id)
  )
    return null;

  return {
    type: "provider",
    provider: material.provider,
    api: material.api,
    model: material.model,
    data: jsonValue(material.data),
  };
}

function jsonValue(value: Json): JsonValue {
  if (value === null || typeof value !== "object") return value;

  if (isJsonObject(value))
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, jsonValue(inner)]));

  return value.map(jsonValue);
}
