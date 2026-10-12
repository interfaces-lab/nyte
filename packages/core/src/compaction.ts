import type { Models } from "@nyte-ai/ai";
import { estimateMessageTokens } from "@nyte-ai/ai/utils/estimate";
import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  CompactionPlan,
  Configuration,
  DurableEvent,
  HeadName,
  Json,
  MessageId,
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
  Failure,
  JsonValue,
  Message,
  Model,
  ProviderCheckpointMaterial,
} from "@nyte-ai/schema/model";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { HookContext } from "./hooks.ts";
import { check } from "./json-schema.ts";
import type { Compactor, Kernel, Summarizer } from "./kernel.ts";
import { contributionsOf, modelInfo } from "./models.ts";
import { compaction } from "./parts.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import { LOCAL } from "./principals.ts";
import { decodePartRecord, decodeRunRecord } from "./records.ts";
import type { PartRecord } from "./records.ts";
import { headRef, partRef, runRef, sessionRef } from "./refs.ts";
import { ZERO_USAGE, charge, complete, requestEvent, rideRef } from "./request.ts";
import {
  STALE,
  START,
  attempt,
  commit,
  expectOf,
  isJsonObject,
  load,
  objectOf,
  pathOf,
  put,
  readTip,
  requireSession,
  textOf,
  tipOf,
  withFold,
} from "./session-state.ts";
import type { Found, Tip } from "./session-state.ts";
import { failParts, projectedCommit, requestBody, settling, tokenEstimate } from "./transcript.ts";

type Answer =
  | { readonly kind: "ok"; readonly text: string; readonly usage: Usage; readonly info: ModelInfo }
  | { readonly kind: "failed"; readonly failure: Failure };

/** Returns what a compaction writes: the part's settled state, the usage it cost and its `request` event. */
type Written =
  | {
      readonly kind: "ok";
      readonly state: Json;
      readonly usage: Usage | null;
      readonly event: DurableEvent | null;
    }
  | { readonly kind: "failed"; readonly failure: Failure };

const NOTE: Placement = { kind: "transcript", role: "note" };

const STALE_HEAD: Failure = {
  class: "runner",
  message: "The head moved while the compaction ran; nothing was compacted.",
};

const RESULT_LIMIT = 2_000;

const COMPACTION_SYSTEM =
  "You summarise a coding agent's conversation so that another model can continue it from the summary alone.";

const BRANCH_SYSTEM =
  "You summarise an abandoned branch of a coding agent's conversation so that the conversation can continue without it.";

/** Returns the head's latest compaction state on its committed path, or null. */
export async function latestCompaction(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Json | null> {
  return withFold(kernel, session, (state) => {
    const path = pathOf(state.commits, tipOf(state.heads.get(head)?.info.tip ?? START));

    for (const id of [...path].reverse()) {
      const body = state.commits.get(id)?.body;

      if (body?.kind === "compaction") return state.parts.get(body.part)?.state ?? null;
    }

    return null;
  });
}

/**
 * Returns the manual compaction `Head.compact` starts once it found no live run: the request body
 * built and split as a turn's, `nothing-to-compact` when nothing committed precedes the tail.
 * Otherwise the `compaction` part is written live and `started` answered at once; the summary runs
 * in the background and settles the part with its commit in one set, or fails it.
 */
export function createCompactor(kernel: Kernel, models: Models): Compactor {
  return async ({ session, head, instructions }) => {
    const runtime = kernel.pluginsFor(session);
    const configuration = await configurationOf(kernel, runtime, session, head);
    const { model } = configuration;
    const info = await modelInfo(kernel, models, model, runtime);

    if (info === null)
      throw new SdkError("invalid", `No model ${model.provider}/${model.id} is in the catalog.`);
    const tip = await readTip(kernel, session, head);
    const body = { session, head, run: null, configuration };
    const { transcript } = await requestBody(kernel, models, runtime, body);
    const split = splitOf(transcript, info);

    if (split === null) return { kind: "nothing-to-compact" };
    const tokensBefore = tokenEstimate(transcript);
    const part = asId<"part">(crypto.randomUUID());
    const state: Json = { summary: null, material: null, tokensBefore, usage: null };

    const record: PartRecord = {
      id: part,
      partKind: "compaction",
      placement: NOTE,
      state,
      version: 1,
      owner: null,
      run: null,
      status: { kind: "live", run: null },
    };

    await commit(kernel, [
      {
        name: partRef(session, part),
        target: await put(kernel, "part", record),
        expect: "absent",
        event: {
          head,
          kind: "part",
          part,
          change: "created",
          partKind: "compaction",
          placement: NOTE,
          state,
          version: 1,
          run: null,
          owner: null,
        },
      },
    ]);

    const plan: CompactionPlan = {
      model: configuration.model,
      reason: "manual",
      instructions,
      tokensBefore,
      summarise: split.summarise,
      keep: split.keep,
      result: null,
    };

    void compactManually(kernel, models, runtime, { session, head, part, tip, plan, info }).catch(
      () => undefined,
    );

    return { kind: "started", message: asId<"message">(part) };
  };
}

/**
 * Compacts a run's request body (§38s): splits it into what is summarised and the retained tail
 * (`skipped` when nothing committed precedes it), runs `before_compaction`, and writes its result
 * or one summary request's as a `compaction` part with its commit, `request` event and run charge
 * in one set. A failed summary, an invalid hook result or a throwing hook is `failed`.
 */
export async function compactIfNeeded(
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
  | { readonly kind: "compacted"; readonly message: MessageId }
  | { readonly kind: "skipped" }
  | { readonly kind: "failed"; readonly failure: Failure }
> {
  const { session, head, run } = input;
  const tokensBefore = tokenEstimate(input.transcript);
  const split = splitOf(input.transcript, input.info);
  dev("compaction", input.reason, { session, run: run.id, tokensBefore, at: input.info.compactAt });

  if (split === null) return { kind: "skipped" };
  const where = { session, head, run: run.id, principal: LOCAL };

  const plan = await runtime.hooks.transform(
    "before_compaction",
    {
      model: input.configuration.model,
      reason: input.reason,
      instructions: null,
      tokensBefore,
      summarise: split.summarise,
      keep: split.keep,
      result: null,
    },
    where,
  );

  const written = await writtenOf(kernel, models, runtime, {
    where,
    plan,
    info: input.info,
    signal: input.signal,
  });

  if (written.kind === "failed") return written;
  const part = asId<"part">(crypto.randomUUID());

  await attempt(`Compacting ${head}`, async () => {
    const tip = await readTip(kernel, session, head);
    const input = { session, head, run: run.id, part, live: null, tip, plan, written };

    return (await writeCompaction(kernel, input)) ? undefined : STALE;
  });

  dev("compaction", "compacted", { session, run: run.id, part });

  return { kind: "compacted", message: asId<"message">(part) };
}

/**
 * Returns the summariser `move({ abandoned: summarize })` runs: the abandoned commits as text, one
 * request with the head's model for a short markdown summary (`before_request` step `summary`),
 * and its `request` event riding the session ref. `failed { reason }` when anything fails.
 */
export function createSummarizer(kernel: Kernel, models: Models): Summarizer {
  return async ({ session, head, commits, instructions, signal }) => {
    if (commits.length === 0) return { kind: "ok", markdown: "", usage: ZERO_USAGE };

    try {
      const runtime = kernel.pluginsFor(session);
      const configuration = await configurationOf(kernel, runtime, session, head);

      const lines = await withFold(kernel, session, (state) =>
        commits.flatMap((id): readonly string[] => {
          const body = state.commits.get(id)?.body;

          if (body === undefined) return [];

          if (body.kind === "user") return [`User: ${textOf(body.content)}`];
          const part = state.parts.get(body.part);

          return part === undefined ? [] : [lineOf(kernel, part)];
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
      return { kind: "failed", reason: messageOf(error) };
    }
  };
}

/** Returns the update charging a compaction's usage to its run record (§38v), bumping `requests` with its `request` event (§38w). */
async function charged(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  written: Extract<Written, { readonly kind: "ok" }>,
): Promise<readonly RefUpdate[]> {
  const { usage, event } = written;

  if (usage === null && event === null) return [];
  const name = runRef(session, run);
  const found = await load(kernel, await kernel.store.refs.get(name), decodeRunRecord);

  if (found === null) throw new SdkError("internal", `Run ${run} has no record.`);

  return [
    {
      name,
      target: await put(kernel, "run", charge(found.record, usage, event !== null)),
      expect: found.ref.revision,
    },
  ];
}

/** Runs a manual compaction's plan and request in the background and settles its live part: compacted in one set, or failed. */
async function compactManually(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly part: PartId;
    readonly tip: Tip;
    readonly plan: CompactionPlan;
    readonly info: ModelInfo;
  },
): Promise<void> {
  const { session, head, part } = input;
  const where = { session, head, run: null, principal: LOCAL };
  let failure: Failure | null = null;

  try {
    const plan = await runtime.hooks.transform("before_compaction", input.plan, where);

    const written = await writtenOf(kernel, models, runtime, {
      where,
      plan,
      info: input.info,
      signal: new AbortController().signal,
    });

    const live = await load(
      kernel,
      await kernel.store.refs.get(partRef(session, part)),
      decodePartRecord,
    );

    if (written.kind === "failed") failure = written.failure;
    else if (
      live?.record.status.kind !== "live" ||
      !(await writeCompaction(kernel, { ...input, run: null, live, plan, written }))
    )
      failure = STALE_HEAD;
  } catch (error) {
    failure = { class: "runner", message: messageOf(error) };
  }

  if (failure !== null) await failParts(kernel, session, head, [part], failure);
}

/** Writes a compaction in one set (its part created, or the live one updated, settled, its commit, `head moved` outside a run, its charge), false when the head or the part moved. */
async function writeCompaction(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly part: PartId;
    readonly live: Found<PartRecord> | null;
    readonly tip: Tip;
    readonly plan: CompactionPlan;
    readonly written: Extract<Written, { readonly kind: "ok" }>;
  },
): Promise<boolean> {
  const { session, head, run, part, live, tip, written } = input;
  const { state } = written;
  const at = Date.now();
  const name = partRef(session, part);
  const version = live === null ? 1 : live.record.version + 1;

  const landed = await settling(kernel, {
    session,
    head,
    run,
    parent: tip.id,
    expect: expectOf(tip.ref),
    record:
      live === null
        ? {
            id: part,
            partKind: "compaction",
            placement: NOTE,
            state,
            version,
            owner: null,
            run,
            status: { kind: "live", run },
          }
        : { ...live.record, state, version },
    body: {
      kind: "compaction",
      part,
      replaces: await replacesOf(kernel, session, tip, input.plan),
    },
    at,
  });

  const { target } = landed;

  const outcome = await commit(kernel, [
    live === null
      ? {
          name,
          target,
          expect: "absent",
          event: {
            head,
            kind: "part",
            part,
            change: "created",
            partKind: "compaction",
            placement: NOTE,
            state,
            version,
            run,
            owner: null,
          },
        }
      : {
          name,
          target,
          expect: live.ref.revision,
          event: { head, kind: "part", part, change: "updated", state, version },
        },
    ...landed.updates,
    ...(run === null
      ? [
          {
            name: headRef(session, head),
            target: objectOf(landed.landed),
            event: {
              head,
              kind: "head",
              from: tip.id,
              to: landed.landed,
              reason: "moved",
            } as const,
          },
        ]
      : []),
    ...(written.event === null ? [] : [{ name, target, event: written.event }]),
    ...(run === null ? [] : await charged(kernel, session, run, written)),
  ]);

  return outcome.kind === "set";
}

/** Returns what a plan writes: its `result`, validated once here (§D9), or one summary request's answer. */
async function writtenOf(
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

/** Sends one summary request with `before_request` for its step; an empty answer is a failure. */
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

/** Splits a transcript after its leading system message into what is summarised and the retained tail (a fifth of the window, from the latest user message when that fits, never parting a call from its result); null when nothing committed precedes the tail. */
function splitOf(
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

/** Returns the commits a compaction replaces on the path to `tip`: those older than the oldest kept message's commit with every summarised one's; without a kept commit, the path up to the newest summarised one. */
async function replacesOf(
  kernel: Kernel,
  session: SessionId,
  tip: Tip,
  plan: CompactionPlan,
): Promise<readonly CommitId[]> {
  const path = await withFold(kernel, session, (state) => pathOf(state.commits, tip.id));

  const indexes = (messages: readonly Message[]): readonly number[] =>
    messages.flatMap((message) => {
      const commit = projectedCommit(message);
      const index = commit === null ? -1 : path.indexOf(commit);

      return index < 0 ? [] : [index];
    });

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

/** Returns a head's configuration resolved from its stored selection once its runtime is ready; throws `invalid` when it does not resolve. */
async function configurationOf(
  kernel: Kernel,
  runtime: PluginRuntime,
  session: SessionId,
  head: HeadName,
): Promise<Configuration> {
  const found = await requireSession(kernel, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  await runtime.ready;

  const resolved = await kernel.resolveConfiguration({
    session,
    head,
    selected: entry.selected,
    patch: null,
    contributions: contributionsOf(runtime),
  });

  if (resolved.kind !== "exact")
    throw new SdkError("invalid", `The head's configuration is ${resolved.kind}.`);

  return resolved;
}

/** Returns model messages as plain text for a summary request. */
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
        case "toolResult": {
          const result = contentText(message.content);

          const clipped =
            result.length > RESULT_LIMIT ? `${result.slice(0, RESULT_LIMIT)}…` : result;

          return [`${message.toolName} ${message.isError ? "failed" : "returned"}: ${clipped}`];
        }
      }
    })
    .join("\n\n");
}

/** Returns one abandoned part as a line of text: a text part's markdown, a tool part's name, arguments and outcome, else its fallback. */
function lineOf(kernel: Kernel, part: PartRecord): string {
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns the head's latest compaction material as the checkpoint when the request model's provider identity made it (§38e); an invalid stored state is a corrupt store. */
export async function checkpointOf(
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

/** Returns a JSON value as the provider's mutable JSON. */
function jsonValue(value: Json): JsonValue {
  if (isList(value)) return value.map(jsonValue);

  if (isJsonObject(value))
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, jsonValue(inner)]));

  return value;
}

function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}
