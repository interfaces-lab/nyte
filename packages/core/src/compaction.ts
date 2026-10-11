import type { Models } from "@nyte-ai/ai";
import { estimateMessageTokens } from "@nyte-ai/ai/utils/estimate";
import { classifyAssistantFailure } from "@nyte-ai/ai/utils/failure";
import { retryAssistantCall } from "@nyte-ai/ai/utils/retry";
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
import type { Failure, Message } from "@nyte-ai/schema/model";
import { contributionsOf } from "./configuration.ts";
import { projectedCommit, requestBody, tokenEstimate } from "./context.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { Compactor, Kernel, Summarizer } from "./kernel.ts";
import { modelInfo, withLimits } from "./models.ts";
import { LOCAL } from "./principals.ts";
import { decodePartRecord, decodeRunRecord } from "./records.ts";
import type { CommitRecord, PartRecord } from "./records.ts";
import { headRef, partRef, runRef, sessionRef } from "./refs.ts";
import { RETRY_POLICY, addUsage, requestEvent, rideRef, usageOf } from "./request.ts";
import {
  STALE,
  attempt,
  commit,
  expectOf,
  isJsonObject,
  load,
  objectOf,
  pathOf,
  put,
  putCommit,
  readTip,
  requireSession,
  textOf,
  withFold,
} from "./session-state.ts";
import type { Tip } from "./session-state.ts";

/** Returns a transcript split for compaction: what is summarised and the retained tail. */
interface Split {
  readonly summarise: readonly Message[];
  readonly keep: readonly Message[];
}

/** Returns what one summary request answered: its text with the usage it was charged and the model it ran on, or why it failed. */
type Answer =
  | { readonly kind: "ok"; readonly text: string; readonly usage: Usage; readonly info: ModelInfo }
  | { readonly kind: "failed"; readonly failure: Failure };

/** Returns what a compaction writes: the part's settled state, the usage it cost, and, when a request ran, its `request` event. */
type Written =
  | {
      readonly kind: "ok";
      readonly state: Json;
      readonly usage: Usage | null;
      readonly event: DurableEvent | null;
    }
  | { readonly kind: "failed"; readonly failure: Failure };

const NOTE: Placement = { kind: "transcript", role: "note" };

const SKIPPED = { kind: "skipped" } as const;

const ZERO: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const STALE_HEAD: Failure = {
  class: "runner",
  message: "The head moved while the compaction ran; nothing was compacted.",
};

const RESULT_LIMIT = 2_000;

const COMPACTION_SYSTEM =
  "You summarise a coding agent's conversation so that another model can continue it from the summary alone.";

const BRANCH_SYSTEM =
  "You summarise an abandoned branch of a coding agent's conversation so that the conversation can continue without it.";

/** Returns the manual compaction `Head.compact` starts once it found no live run: what `kernel.compact` holds. Resolves the head's configuration (`kernel.resolveConfiguration` with its stored selection and no patch; a failure throws `SdkError("invalid")`), builds its request body as a turn pass does with no run (`buildContext`, `transform_context`, the session's tools, `transcriptOf`, `transform_transcript`) and splits it as `compactIfNeeded` does with reason `manual` and the given `instructions`; nothing to summarise (no committed message before the retained tail) answers `nothing-to-compact`. Otherwise it mints the part id, writes the `compaction` part live (placement transcript `note`, owner null, run null, state `{ summary: null, material: null, tokensBefore, usage: null }`) and answers `started { message }` with that id at once; the summary runs in the background as `compactIfNeeded`'s does, then `[part updated, part settled, commit { kind: "compaction", part, replaces }, head moved]` in one set, or `part failed { failure }` when the request or a hook fails, or when the head moved meanwhile (`stale`). */
export function createCompactor(kernel: Kernel, models: Models): Compactor {
  return async ({ session, head, instructions }) => {
    const configuration = await configurationOf(kernel, session, head);
    const info = await infoOf(kernel, models, configuration.model, session);
    const tip = await readTip(kernel, session, head);
    const { transcript } = await requestBody(kernel, models, session, head, null, configuration);
    const split = splitOf(transcript, info);

    if (split === null) return { kind: "nothing-to-compact" };
    const tokensBefore = tokenEstimate(transcript);
    const part = asId<"part">(crypto.randomUUID());
    const state: Json = { summary: null, material: null, tokensBefore, usage: null };
    const at = Date.now();

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
        target: await put(kernel, "part", record, at),
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

    void compactManually(kernel, models, {
      session,
      head,
      part,
      tip,
      plan: {
        model: configuration.model,
        reason: "manual",
        instructions,
        tokensBefore,
        summarise: split.summarise,
        keep: split.keep,
        result: null,
      },
    }).catch(() => undefined);

    return { kind: "started", message: asId<"message">(part) };
  };
}

/** Compacts a run's request body when it no longer fits, after `transform_transcript` and before `before_request` (§38s): skipped while `tokenEstimate(transcript)` is at most `info.compactAt` (reason `threshold`; reason `overflow`, after the provider reported a context overflow, always compacts). Splits the transformed transcript's messages after its leading system message into what is summarised and the retained tail (`keep`: the newest messages within a fifth of the window, from the latest user message when that fits, never parting a tool call from its result); nothing before the tail → skipped. Dispatches `before_compaction` (transform, 300 s budget) with a `CompactionPlan` `{ model, reason, instructions: null, tokensBefore, summarise, keep, result: null }`. A plan with `result` set is written as given without a request (`summary` text, or provider `material` `{ provider, api, model, data }` with its usage, §38e); otherwise one request summarises `plan.summarise` with `plan.model`, `before_request` (step `compaction`) applied to it and `after_request` observed, under `RETRY_POLICY`. The `compaction` part (id minted, placement transcript `note`, owner null, `run` this run, state `{ summary, material, tokensBefore, usage }`) and the commit `{ kind: "compaction", part, replaces }` (`replaces` the committed path's commits older than the oldest commit a `keep` message projects from, `projectedCommit`, with every commit a `summarise` message projects from; when no `keep` message maps to a commit, the path up to the newest commit a `summarise` message projects from) land in one set with `[part created, part settled, commit]`, plus a `request` event with step `compaction` when a request ran, the summary's usage added to the run record's `usage` and, with the event, its `requests` bumped (§38v, w). Resolves `compacted { message }` with the part id; a failed summary request throws, failing the run. */
export async function compactIfNeeded(
  kernel: Kernel,
  models: Models,
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
  { readonly kind: "compacted"; readonly message: MessageId } | { readonly kind: "skipped" }
> {
  const { session, head, run } = input;
  const tokensBefore = tokenEstimate(input.transcript);
  dev("compaction", input.reason, { session, run: run.id, tokensBefore, at: input.info.compactAt });

  if (input.reason === "threshold" && tokensBefore <= input.info.compactAt) return SKIPPED;
  const split = splitOf(input.transcript, input.info);

  if (split === null) return SKIPPED;

  const plan = await kernel.pluginsFor(session).hooks.transform(
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
    { session, head, run: run.id, principal: LOCAL },
  );

  const written = await writtenOf(kernel, models, {
    session,
    head,
    run: run.id,
    plan,
    signal: input.signal,
  });

  if (written.kind === "failed")
    throw new SdkError("unavailable", `Compaction failed: ${written.failure.message}`);
  const part = asId<"part">(crypto.randomUUID());

  await attempt(`Compacting ${head}`, async () => {
    const tip = await readTip(kernel, session, head);
    const at = Date.now();

    const record: CommitRecord = {
      parent: tip.id,
      at,
      run: run.id,
      body: { kind: "compaction", part, replaces: await replacesOf(kernel, session, tip, plan) },
    };

    const landed = await putCommit(kernel, record);
    const name = partRef(session, part);

    const target = await put(
      kernel,
      "part",
      {
        id: part,
        partKind: "compaction",
        placement: NOTE,
        state: written.state,
        version: 1,
        owner: null,
        run: run.id,
        status: { kind: "settled", commit: landed, endedAt: at },
      },
      at,
    );

    const updates: readonly RefUpdate[] = [
      {
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
          state: written.state,
          version: 1,
          run: run.id,
          owner: null,
        },
      },
      {
        name,
        target,
        event: { head, kind: "part", part, change: "settled", commit: landed, endedAt: at },
      },
      {
        name: headRef(session, head),
        target: objectOf(landed),
        expect: expectOf(tip.ref),
        event: { head, kind: "commit", id: landed, parent: tip.id, run: run.id, body: record.body },
      },
      ...(written.event === null ? [] : [{ name, target, event: written.event }]),
      ...(await charged(kernel, session, run.id, written.usage, written.event !== null)),
    ];

    return (await commit(kernel, updates)).kind === "set" ? undefined : STALE;
  });

  dev("compaction", "compacted", { session, run: run.id, part });

  return { kind: "compacted", message: asId<"message">(part) };
}

/** Returns the summariser `move({ abandoned: summarize })` runs: what `kernel.summarize` holds. Reads the abandoned commits from the fold as text (user content as text, text parts as markdown, a tool part as its name, arguments and outcome in one line, any other part as its `fallback`), resolves the head's configuration as `createCompactor` does, and sends one request with that model asking for a short markdown summary of what the abandoned path tried and found, following `instructions` when given: `before_request` with step `summary`, `RETRY_POLICY`, `after_request` observed and a `request` event with step `summary` on the head (riding the session ref, so the head ref the move compare-and-sets stays where it was). Resolves `ok { markdown, usage }`, or `failed { reason }` when the request fails or the signal aborts; no commit is abandoned → `ok` with empty markdown and zero usage. */
export function createSummarizer(kernel: Kernel, models: Models): Summarizer {
  return async ({ session, head, commits, instructions, signal }) => {
    if (commits.length === 0) return { kind: "ok", markdown: "", usage: ZERO };

    try {
      const configuration = await configurationOf(kernel, session, head);

      const lines = await withFold(kernel, session, (state) =>
        commits.flatMap((id): readonly string[] => {
          const body = state.commits.get(id)?.body;

          if (body === undefined) return [];

          if (body.kind === "user") return [`User: ${textOf(body.content)}`];
          const part = state.parts.get(body.part);

          return part === undefined ? [] : [lineOf(kernel, part)];
        }),
      );

      const answer = await ask(kernel, models, {
        session,
        head,
        run: null,
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

/** Returns the update adding a compaction's usage to its run record's `usage` (§38v) and, when its set carries a `request` event, bumping its `requests` (§38w), compare-and-set on the run ref; none without usage or once the run is gone. */
async function charged(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  usage: Usage | null,
  requested: boolean,
): Promise<readonly RefUpdate[]> {
  if (usage === null && !requested) return [];
  const name = runRef(session, run);
  const found = await load(kernel, await kernel.store.refs.get(name), decodeRunRecord);

  if (found === null) return [];

  return [
    {
      name,
      target: await put(kernel, "run", {
        ...found.record,
        usage: usage === null ? found.record.usage : addUsage(found.record.usage ?? ZERO, usage),
        requests: found.record.requests + (requested ? 1 : 0),
      }),
      expect: found.ref.revision,
    },
  ];
}

/** Runs a manual compaction's plan and request in the background and settles its live part: compacted in one set, or failed. */
async function compactManually(
  kernel: Kernel,
  models: Models,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly part: PartId;
    readonly tip: Tip;
    readonly plan: CompactionPlan;
  },
): Promise<void> {
  const { session, head, part, tip } = input;
  let failure: Failure | null = null;

  try {
    const plan = await kernel.pluginsFor(session).hooks.transform("before_compaction", input.plan, {
      session,
      head,
      run: null,
      principal: LOCAL,
    });

    const written = await writtenOf(kernel, models, {
      session,
      head,
      run: null,
      plan,
      signal: new AbortController().signal,
    });

    if (written.kind === "failed") failure = written.failure;
    else if (!(await settleManual(kernel, { session, head, part, tip, plan, written })))
      failure = STALE_HEAD;
  } catch (error) {
    failure = { class: "runner", message: messageOf(error) };
  }

  if (failure !== null) await failPart(kernel, session, head, part, failure);
}

/** Writes a manual compaction's settlement in one set, `[part updated, part settled, commit, head moved]` and its `request` event; false when the head or the part moved since the compaction started. */
async function settleManual(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly part: PartId;
    readonly tip: Tip;
    readonly plan: CompactionPlan;
    readonly written: Extract<Written, { readonly kind: "ok" }>;
  },
): Promise<boolean> {
  const { session, head, part, tip, written } = input;
  const name = partRef(session, part);
  const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

  if (found === null || found.record.status.kind !== "live") return false;
  const at = Date.now();

  const record: CommitRecord = {
    parent: tip.id,
    at,
    run: null,
    body: {
      kind: "compaction",
      part,
      replaces: await replacesOf(kernel, session, tip, input.plan),
    },
  };

  const landed = await putCommit(kernel, record);
  const version = found.record.version + 1;

  const target = await put(
    kernel,
    "part",
    {
      ...found.record,
      state: written.state,
      version,
      status: { kind: "settled", commit: landed, endedAt: at },
    },
    at,
  );

  const outcome = await commit(kernel, [
    {
      name,
      target,
      expect: found.ref.revision,
      event: { head, kind: "part", part, change: "updated", state: written.state, version },
    },
    {
      name,
      target,
      event: { head, kind: "part", part, change: "settled", commit: landed, endedAt: at },
    },
    {
      name: headRef(session, head),
      target: objectOf(landed),
      expect: expectOf(tip.ref),
      event: { head, kind: "commit", id: landed, parent: tip.id, run: null, body: record.body },
    },
    {
      name: headRef(session, head),
      target: objectOf(landed),
      event: { head, kind: "head", from: tip.id, to: landed, reason: "moved" },
    },
    ...(written.event === null ? [] : [{ name, target, event: written.event }]),
  ]);

  return outcome.kind === "set";
}

/** Fails a live compaction part with `part failed`; a part no longer live is left as it is. */
async function failPart(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  part: PartId,
  failure: Failure,
): Promise<void> {
  await attempt(`Failing part ${part}`, async () => {
    const name = partRef(session, part);
    const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

    if (found === null || found.record.status.kind !== "live") return undefined;

    const outcome = await commit(kernel, [
      {
        name,
        target: await put(kernel, "part", {
          ...found.record,
          status: { kind: "failed", run: found.record.run, failure },
        }),
        expect: found.ref.revision,
        event: { head, kind: "part", part, change: "failed", failure },
      },
    ]);

    return outcome.kind === "set" ? undefined : STALE;
  });
}

/** Returns what a plan writes: its `result` as given, or one summary request's answer. */
async function writtenOf(
  kernel: Kernel,
  models: Models,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly plan: CompactionPlan;
    readonly signal: AbortSignal;
  },
): Promise<Written> {
  const { plan } = input;
  const result = plan.result;

  if (result?.kind === "summary")
    return {
      kind: "ok",
      state: { summary: result.text, material: null, tokensBefore: plan.tokensBefore, usage: null },
      usage: null,
      event: null,
    };

  if (result?.kind === "material")
    return {
      kind: "ok",
      state: {
        summary: null,
        material: {
          provider: result.provider,
          api: result.api,
          model: result.model,
          data: result.data,
        },
        tokensBefore: plan.tokensBefore,
        usage: result.usage,
      },
      usage: result.usage,
      event: null,
    };

  const answer = await ask(kernel, models, {
    session: input.session,
    head: input.head,
    run: input.run,
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
    event: requestEvent(input.head, "compaction", answer.usage, answer.info),
  };
}

/** Sends one summary request: `before_request` with the step, the model's request under `RETRY_POLICY`, each attempt through `withLimits`, `after_request` observed; an empty answer is a failure. */
async function ask(
  kernel: Kernel,
  models: Models,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly model: ModelRef;
    readonly step: "compaction" | "summary";
    readonly system: string;
    readonly prompt: string;
    readonly signal: AbortSignal;
  },
): Promise<Answer> {
  const { session, step, signal } = input;
  const hooks = kernel.pluginsFor(session).hooks;
  const where = { session, head: input.head, run: input.run, principal: LOCAL };

  const request = await hooks.transform(
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

  const model = models.getModel(request.model.provider, request.model.id);
  const info = await modelInfo(kernel, models, request.model, session);

  if (model === undefined || info === null)
    return {
      kind: "failed",
      failure: {
        class: "runner",
        message: `No model ${request.model.provider}/${request.model.id} is in the catalog.`,
      },
    };

  const thinking = request.thinking;
  const started = Date.now();

  const message = await retryAssistantCall(
    () =>
      withLimits(kernel, models, model.provider, () =>
        models.completeSimple(
          model,
          {
            systemPrompt: input.system,
            messages: [{ role: "user", content: input.prompt, timestamp: started }],
          },
          {
            signal,
            reasoning: thinking === "off" ? undefined : thinking,
            samplingParams: { ...request.options.sampling },
            headers: { ...request.options.headers },
            sessionId: session,
          },
        ),
      ),
    RETRY_POLICY,
    signal,
  );

  const usage = usageOf(message, info);

  void hooks.observe(
    "after_request",
    { model: request.model, thinking, usage, durationMs: Date.now() - started, step },
    where,
  );

  if (message.stopReason === "error" || message.stopReason === "aborted")
    return { kind: "failed", failure: classifyAssistantFailure(message) };
  const text = contentText(message.content).trim();

  if (text === "")
    return {
      kind: "failed",
      failure: { class: "provider", message: "The summary came back empty." },
    };

  return { kind: "ok", text, usage, info };
}

/** Splits a transcript after its leading system message into what is summarised and the retained tail; null when nothing committed is before the tail. */
function splitOf(transcript: Transcript, info: ModelInfo): Split | null {
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

/** Returns the commits a compaction replaces on the path to `tip`: those older than the oldest commit a kept message projects from, with every commit a summarised one projects from; when no kept message maps to a commit, the path up to the newest commit a summarised one projects from. */
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

/** Returns a head's configuration resolved from its stored selection; throws `invalid` when it does not resolve. */
async function configurationOf(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Configuration> {
  const found = await requireSession(kernel, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  await kernel.pluginsFor(session).ready;

  const resolved = await kernel.resolveConfiguration({
    session,
    head,
    selected: entry.selected,
    patch: null,
    contributions: contributionsOf(kernel.pluginsFor(session)),
  });

  if (resolved.kind !== "exact")
    throw new SdkError("invalid", `The head's configuration is ${resolved.kind}.`);

  return resolved;
}

/** Returns a catalog model's info in a session; throws `invalid` when the catalog lacks it. */
async function infoOf(
  kernel: Kernel,
  models: Models,
  ref: ModelRef,
  session: SessionId,
): Promise<ModelInfo> {
  const info = await modelInfo(kernel, models, ref, session);

  if (info === null)
    throw new SdkError("invalid", `No model ${ref.provider}/${ref.id} is in the catalog.`);

  return info;
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
        case "toolResult":
          return [
            `${message.toolName} ${message.isError ? "failed" : "returned"}: ${clipped(contentText(message.content))}`,
          ];
      }
    })
    .join("\n\n");
}

/** Returns one abandoned part as a line of text: a text part's markdown, a tool part's name, arguments and outcome, else its definition's fallback. */
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

/** Returns text cut to a summary request's per-result bound. */
function clipped(content: string): string {
  return content.length > RESULT_LIMIT ? `${content.slice(0, RESULT_LIMIT)}…` : content;
}

/** Returns an error's message, or the thrown value as text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
