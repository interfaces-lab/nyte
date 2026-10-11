import type { Models } from "@nyte-ai/ai";
import { asId, isJson } from "@nyte-ai/schema";
import type {
  HeadName,
  Json,
  ModelInfo,
  ModelRequest,
  PartId,
  Placement,
  RefUpdate,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  Transcript,
  Usage,
} from "@nyte-ai/schema";
import type {
  Api,
  AssistantMessageEvent,
  Failure,
  JsonValue,
  Model,
  ProviderCheckpointMaterial,
} from "@nyte-ai/schema/model";
import { agentLoop } from "./agent-loop.ts";
import type { LoopConfig, LoopEvent, Prepared } from "./agent-loop.ts";
import { compactIfNeeded } from "./compaction.ts";
import { providerContext, requestBody } from "./context.ts";
import { dev } from "./dev-log.ts";
import type { HookContext } from "./hooks.ts";
import { check } from "./json-schema.ts";
import type { Kernel, LandedInput, TurnDriver } from "./kernel.ts";
import { modelInfo, withLimits } from "./models.ts";
import { createPart } from "./part-handle.ts";
import { compaction, text, thinking } from "./parts.ts";
import { CORE_CONTEXT, LOCAL, PARTICIPANT_AUTHORITY } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodePartRecord, decodeRunRecord } from "./records.ts";
import type { CommitRecord, RunRecord } from "./records.ts";
import { headRef, partRef, runRef } from "./refs.ts";
import { RETRY_POLICY, addUsage, requestEvent, usageOf } from "./request.ts";
import { publishPatch } from "./runs.ts";
import {
  START,
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
  tipOf,
  withFold,
} from "./session-state.ts";
import { executeCall } from "./tool-runner.ts";

/**
 * Returns one merged thought's share of a thinking part's `signature` (§38f): its length in the
 * part's markdown, so a replay splits the thoughts back, and the provider's `thinkingSignature` and
 * `redacted` for it.
 */
type ThoughtSignature = {
  readonly length: number;
  readonly signature: string | null;
  readonly redacted: boolean;
};

/**
 * Returns one text or thinking part a request has open: its id, kind, the markdown streamed into it
 * so far, its provider continuity data, and for thinking how many adjacent thoughts it holds. It
 * stays live until the request's stream is done. Settled, a text part's `signature` is
 * `textSignature` and a thinking part's is `thoughts`, or null when no thought carried a signature
 * and none was redacted.
 */
interface OpenPart {
  readonly part: PartId;
  readonly kind: "text" | "thinking";
  markdown: string;
  merged: number;
  /** Text: the content's `textSignature` from its `text_end`, else null. */
  textSignature: string | null;
  /** Thinking: one entry per merged thought, in order. */
  readonly thoughts: ThoughtSignature[];
}

/** Returns what one attempt of a run holds in memory while its requests stream; a re-drive rebuilds it from the run record and the fold. */
interface AttemptState {
  readonly run: RunView;
  /** The run record's `view.attempt`, which every `run retrying` bumps (§38t). */
  readonly attempt: number;
  /** The index the attempt's next text or thinking part takes in its id `${run}:${attempt}:${index}`, counted from 0 across the attempt's requests. */
  index: number;
  /** Every text and thinking part the current request opened, in opening order: live until its stream is done, then settled together; failed together when the request fails, overflows or is stopped. */
  readonly opened: OpenPart[];
  /** The current request's text and thinking parts still streaming, by the provider's content index, until their `*_end`. */
  readonly parts: Map<number, OpenPart>;
  /** Where each thought still streaming starts in its thinking part's markdown, by content index. */
  readonly starts: Map<number, number>;
  /** The thinking part the next thought merges into; null once text or a tool call streamed after it. */
  merging: OpenPart | null;
}

/** Returns one turn's fixed inputs. */
interface Turn {
  readonly kernel: Kernel;
  readonly models: Models;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly signal: AbortSignal;
  readonly where: HookContext;
}

const ANSWER: Placement = { kind: "transcript", role: "answer" };

const STEP: Placement = { kind: "transcript", role: "step" };

/** One merged thought from the next in a thinking part's markdown: a blank line. */
const THOUGHTS = "\n\n";

const STOPPED: RunEnd = { kind: "stopped" };

/** The connection a run's tool calls act from: `LOCAL` with participant authority. */
const CALLER: ConnectionContext = {
  principal: LOCAL,
  authority: PARTICIPANT_AUTHORITY,
  credential: { kind: "token", token: "" },
  origin: null,
};

const ABORTED: Failure = { class: "aborted", message: "The run was stopped." };

const ORPHANED: Failure = {
  class: "runner",
  message: "The host stopped while this response streamed.",
};

const ZERO: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Returns the turn driver `advance` runs a run's turn with: what `kernel.turn` holds, the adapter
 * between the kernel and `agentLoop` (§45d). It resumes the run's attempt, builds the loop's config
 * from the kernel, and lands each loop event as today's writes. `done` and `parked` end
 * `completed { usage }`, the run record's total; a parked call leaves the run live for `advance`
 * (§34d). `stopped` fails the parts still open with `aborted` when the run is stopping; a turn
 * aborted by the host closing leaves them and the run live for the next open (§38y).
 * `run_started` and `run_ended` are observed by `startRun` and `endRun`, not here (§38q, n).
 */
export function createTurnDriver(kernel: Kernel, models: Models): TurnDriver {
  return {
    run: (input) =>
      turn(
        {
          kernel,
          models,
          session: input.session,
          head: input.head,
          signal: input.signal,
          where: { session: input.session, head: input.head, run: input.run.id, principal: LOCAL },
        },
        input.run,
        () => input.boundary(),
      ),
  };
}

/**
 * Runs one turn: resumes the attempt (`resumed`), runs `agentLoop` from the run record's attempt
 * with `RETRY_POLICY` over the kernel's config, and lands its events.
 */
async function turn(
  context: Turn,
  given: RunView,
  boundary: () => Promise<readonly LandedInput[]>,
): Promise<RunEnd> {
  const { kernel, models, session, head } = context;
  const run = given.id;
  const configuration = given.configuration;
  const { signal } = context;
  const resumedState = await resumed(context, given);

  if (resumedState === null) return STOPPED;
  let state = resumedState;
  let charged = { total: ZERO, requests: 0 };

  const body = () => requestBody(kernel, models, session, head, state.run, configuration);

  const compact = (transcript: Transcript, at: ModelInfo, reason: "threshold" | "overflow") =>
    compactIfNeeded(kernel, models, {
      session,
      head,
      run: state.run,
      configuration,
      transcript,
      info: at,
      reason,
      signal,
    });

  const config: LoopConfig = {
    attempt: state.attempt,
    retry: RETRY_POLICY,
    /**
     * Builds one request in the baseline's hook order (§38s): the configuration's model looked up,
     * with `overflow` set an `overflow` compaction first (nothing to compact fails with the
     * overflow), `requestBody`, a `threshold` compaction (rebuilding the body, never twice in one
     * pass), `before_request` with the attempt on the session's current runtime, the request model
     * looked up, the head's checkpoint and `providerContext`. A model the catalog lacks fails the
     * run `runner`.
     */
    async prepareRequest(asked) {
      const configured = await modelInfo(kernel, models, configuration.model, session);

      if (configured === null)
        return failedRequest(`No model ${configuration.model.id} is in the catalog.`);

      if (asked.overflow !== null) {
        const recovered = await compact((await body()).transcript, configured, "overflow");

        if (recovered.kind === "skipped") return { kind: "failed", failure: asked.overflow };
      }

      let built = await body();

      if ((await compact(built.transcript, configured, "threshold")).kind === "compacted")
        built = await body();

      const request: ModelRequest = await kernel.pluginsFor(session).hooks.transform(
        "before_request",
        {
          model: configuration.model,
          thinking: configuration.thinking,
          step: "assistant",
          attempt: asked.attempt,
          options: { sampling: {}, headers: {} },
        },
        context.where,
      );

      const model = models.getModel(request.model.provider, request.model.id);
      const found = await modelInfo(kernel, models, request.model, session);

      if (model === undefined || found === null)
        return failedRequest(
          `No model ${request.model.provider}/${request.model.id} is in the catalog.`,
        );
      const checkpoint = await checkpointOf(context, model);

      return {
        kind: "request",
        request,
        model,
        info: found,
        context: providerContext(built.transcript, built.source, checkpoint),
        at: Date.now(),
        usage: (message) => usageOf(message, found),
      };
    },
    /**
     * Sets `run phase responding` (clearing `retrying`) and returns `models.streamSimple` with the
     * request's thinking as `reasoning` (none for `"off"`), sampling, headers and output limit.
     * It settles once the response's result did and `withLimits` moved the catalog generation when
     * the response changed the provider's account limits.
     */
    async stream(prepared) {
      await changeRun(context, run, (record) =>
        record.phase === "responding" && record.retrying === null
          ? null
          : {
              record: { ...record, phase: "responding", retrying: null },
              event: { head, kind: "run", run, change: "phase", phase: "responding" },
            },
      );

      const thinkingLevel = prepared.request.thinking;

      const events = models.streamSimple(prepared.model, prepared.context, {
        signal,
        reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
        samplingParams: { ...prepared.request.options.sampling },
        headers: { ...prepared.request.options.headers },
        maxTokens: prepared.info.maxOutput,
        sessionId: session,
      });

      return {
        events,
        settled: withLimits(kernel, models, prepared.model.provider, async () => {
          await events.result();
        }),
      };
    },
    tools: {
      /**
       * Runs the call through the durable `executeCall` as `LOCAL` with participant authority, its
       * id (and tool part id) `${run}:${requests}:${providerCallId}` with `requests` the count the
       * response's own `request` event wrote (§38w); settled or parked.
       */
      execute: (call, called) =>
        executeCall(kernel, {
          session,
          head,
          run,
          call: asId<"call">(`${run}:${charged.requests}:${call.id}`),
          name: call.name,
          args: isJson(call.arguments) ? call.arguments : {},
          context: CALLER,
          signal: called,
        }),
    },
    /**
     * Observes `after_request` (step `assistant`, `durationMs` from the request's preparation) on the
     * session's current runtime, publishes the `request` event on the run ref in
     * the write that adds the usage to the run record and bumps its `requests` (§38v, w), and sets
     * `run phase executing` when the response has calls. It never ends the loop: core has no
     * after-turn decision.
     */
    async finishTurn({ calls, usage, prepared }) {
      const { request, info } = prepared;

      void kernel.pluginsFor(session).hooks.observe(
        "after_request",
        {
          model: request.model,
          thinking: request.thinking,
          usage,
          durationMs: Date.now() - prepared.at,
          step: "assistant",
        },
        context.where,
      );

      charged = await charge(context, run, usage, requestEvent(head, "assistant", usage, info));

      if (calls.length > 0)
        await changeRun(context, run, (record) =>
          record.phase === "executing"
            ? null
            : {
                record: { ...record, phase: "executing" },
                event: { head, kind: "run", run, change: "phase", phase: "executing" },
              },
        );

      return undefined;
    },
    boundary: () => boundary(),
  };

  const land = async (event: LoopEvent): Promise<void> => {
    switch (event.type) {
      case "message_start":
        return opened(context, state, event.kind, event.index);
      case "message_update":
        return updated(context, state, event.event);
      case "message_end":
        return settled(context, state);
      case "turn_retry":
        state = await retry(context, state, event.failure, event.until, event.usage);

        return;
      default:
        return;
    }
  };

  const loop = agentLoop(config, signal);

  for await (const event of loop) {
    dev("turn", event.type, { session, run, attempt: state.attempt });
    await land(event);
  }

  const end = await loop.result();

  switch (end.reason) {
    case "done":
    case "parked":
      return { kind: "completed", usage: charged.total };
    case "stopped":
      if (kernel.runs.isStopping(run)) await failOpen(context, state, ABORTED);

      return STOPPED;
    case "failed":
      await failOpen(context, state, end.failure);

      return { kind: "failed", failure: end.failure };
  }
}

/**
 * Lands `message_start`. Text opens a `text` part (placement transcript `answer`, id
 * `${run}:${attempt}:${index}`, `signature` null). Thinking opens a `thinking` part (transcript
 * `step`, `merged` 1) unless it follows a thought, which it merges into: `merged` + 1, the first id
 * kept, the markdown joined by a blank line. A tool call's start ends the merge.
 */
async function opened(
  context: Turn,
  state: AttemptState,
  kind: "text" | "thinking" | "toolCall",
  index: number,
): Promise<void> {
  if (kind === "toolCall") {
    state.merging = null;

    return;
  }

  if (kind === "text") {
    state.merging = null;
    state.parts.set(index, await open(context, state, "text"));

    return;
  }

  const merging = state.merging;

  if (merging === null) {
    const created = await open(context, state, "thinking");
    state.merging = created;
    state.parts.set(index, created);
    state.starts.set(index, 0);

    return;
  }

  merging.merged += 1;
  append(context, state, merging, THOUGHTS);
  state.parts.set(index, merging);
  state.starts.set(index, merging.markdown.length);
}

/**
 * Lands `message_update`: each delta is a `publishPatch` `append` on its part, and a block's end
 * sets the part's final markdown and its signature (a text's `textSignature`, a thought's
 * `thinkingSignature` and `redacted`, §38f).
 */
async function updated(
  context: Turn,
  state: AttemptState,
  event: AssistantMessageEvent,
): Promise<void> {
  switch (event.type) {
    case "text_delta":
    case "thinking_delta": {
      const found = state.parts.get(event.contentIndex);

      if (found !== undefined) append(context, state, found, event.delta);

      return;
    }

    case "text_end": {
      const found = state.parts.get(event.contentIndex);

      if (found === undefined) return;
      const block = event.partial.content[event.contentIndex];
      found.markdown = event.content;
      found.textSignature =
        block?.type === "text" ? (block.textSignature ?? null) : found.textSignature;
      state.parts.delete(event.contentIndex);

      return;
    }

    case "thinking_end": {
      const found = state.parts.get(event.contentIndex);

      if (found === undefined) return;
      const block = event.partial.content[event.contentIndex];
      const start = state.starts.get(event.contentIndex) ?? 0;
      found.markdown = found.markdown.slice(0, start) + event.content;

      found.thoughts.push({
        length: event.content.length,
        signature: block?.type === "thinking" ? (block.thinkingSignature ?? null) : null,
        redacted: block?.type === "thinking" && block.redacted === true,
      });

      state.starts.delete(event.contentIndex);
      state.parts.delete(event.contentIndex);

      return;
    }

    default:
      return;
  }
}

/**
 * Lands `message_end`: closes the thoughts still streaming, settles every part the response opened
 * with its final markdown and signature in one set (`settle`), and clears the request's parts.
 */
async function settled(context: Turn, state: AttemptState): Promise<void> {
  for (const [index, pending] of state.parts) {
    const start = state.starts.get(index);

    if (pending.kind === "thinking" && start !== undefined)
      pending.thoughts.push({
        length: pending.markdown.length - start,
        signature: null,
        redacted: false,
      });
  }

  await settle(context, state.run.id, state.opened);
  state.opened.length = 0;
  state.parts.clear();
  state.starts.clear();
  state.merging = null;
}

/** Appends a delta to an open part's markdown and publishes it as a patch. */
function append(context: Turn, state: AttemptState, target: OpenPart, delta: string): void {
  target.markdown += delta;
  publishPatch(context.kernel, context.session, state.run.id, {
    kind: "patch",
    part: target.part,
    append: delta,
  });
}

/** Returns a request that fails the run itself. */
function failedRequest(message: string): Prepared {
  return { kind: "failed", failure: { class: "runner", message } };
}

/**
 * Returns the attempt a drive resumes: the run record's, or the next one when the run still has
 * live text or thinking parts of its own (the host died mid-stream), which it fails in the same set
 * as `run retrying` with `until` now. The next part index counts the parts the attempt already
 * made. Null once the run is gone.
 */
async function resumed(context: Turn, run: RunView): Promise<AttemptState | null> {
  const { kernel, session } = context;

  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run.id)),
    decodeRunRecord,
  );

  if (found === null) return null;

  const orphans = await withFold(kernel, session, (state) =>
    [...state.parts.values()].flatMap((part) =>
      part.run === run.id &&
      part.status.kind === "live" &&
      (part.partKind === "text" || part.partKind === "thinking")
        ? [part.id]
        : [],
    ),
  );

  const current = fresh(found.record.view, 0);

  const state =
    orphans.length === 0
      ? current
      : await retry(context, current, ORPHANED, Date.now(), null, orphans);

  const prefix = `${run.id}:${state.attempt}:`;

  state.index = await withFold(
    kernel,
    session,
    (folded) => [...folded.parts.keys()].filter((id) => id.startsWith(prefix)).length,
  );

  return state;
}

/** Opens a text or thinking part for the attempt's next index, live in the run, and adds it to the request's `opened`. */
async function open(context: Turn, state: AttemptState, kind: OpenPart["kind"]): Promise<OpenPart> {
  const part = asId<"part">(`${state.run.id}:${state.attempt}:${state.index}`);
  state.index += 1;

  const input = {
    id: part,
    run: state.run.id,
    head: context.head,
    placement: kind === "text" ? ANSWER : STEP,
  };

  if (kind === "text")
    await createPart(context.kernel, CORE_CONTEXT, context.session, text, {
      ...input,
      state: { markdown: "", signature: null },
    });
  else
    await createPart(context.kernel, CORE_CONTEXT, context.session, thinking, {
      ...input,
      state: { markdown: "", merged: 1, signature: null },
    });

  const opened: OpenPart = {
    part,
    kind,
    markdown: "",
    merged: 1,
    textSignature: null,
    thoughts: [],
  };

  state.opened.push(opened);

  return opened;
}

/**
 * Settles the parts a request opened, once its stream is done, with their final markdown and
 * signatures in one set: for each in opening order its `part updated`, `part settled` and commit,
 * each commit the parent of the next. A part no longer live (its run's fence failed it) is left out.
 */
async function settle(context: Turn, run: RunId, opened: readonly OpenPart[]): Promise<void> {
  const { kernel, session, head } = context;

  if (opened.length === 0) return;

  await attempt(`Settling the parts of run ${run}`, async () => {
    const [live, tip] = await Promise.all([
      Promise.all(
        opened.map(async (entry) => {
          const found = await load(
            kernel,
            await kernel.store.refs.get(partRef(session, entry.part)),
            decodePartRecord,
          );

          return found === null || found.record.status.kind !== "live" ? [] : [{ entry, found }];
        }),
      ).then((entries) => entries.flat()),
      readTip(kernel, session, head),
    ]);

    if (live.length === 0) return undefined;
    const at = Date.now();
    const updates: RefUpdate[] = [];
    let parent = tip.id;

    for (const [index, { entry, found }] of live.entries()) {
      const name = partRef(session, entry.part);

      const settled: Json =
        entry.kind === "text"
          ? { markdown: entry.markdown, signature: entry.textSignature }
          : {
              markdown: entry.markdown,
              merged: entry.merged,
              signature: thoughtsOf(entry.thoughts),
            };

      const record: CommitRecord = { parent, at, run, body: { kind: "part", part: entry.part } };
      const landed = await putCommit(kernel, record);
      const version = found.record.version + 1;

      const target = await put(
        kernel,
        "part",
        {
          ...found.record,
          state: settled,
          version,
          status: { kind: "settled", commit: landed, endedAt: at },
        },
        at,
      );

      updates.push(
        {
          name,
          target,
          expect: found.ref.revision,
          event: {
            head,
            kind: "part",
            part: entry.part,
            change: "updated",
            state: settled,
            version,
          },
        },
        {
          name,
          target,
          event: {
            head,
            kind: "part",
            part: entry.part,
            change: "settled",
            commit: landed,
            endedAt: at,
          },
        },
        {
          name: headRef(session, head),
          target: objectOf(landed),
          expect: index === 0 ? expectOf(tip.ref) : undefined,
          event: { head, kind: "commit", id: landed, parent, run, body: record.body },
        },
      );
      parent = landed;
    }

    return (await commit(kernel, updates)).kind === "set" ? undefined : STALE;
  });
}

/**
 * Lands `turn_retry` (and a resumed run's orphans): fails every part the attempt's current request
 * opened, and `extra`, and publishes `run retrying { attempt + 1, until, reason }` with the run
 * record's `retrying` set, its `view.attempt` bumped and the failed request's `charged` usage added
 * to its `usage` (§38t, v), in one set. Returns the next attempt's state.
 */
async function retry(
  context: Turn,
  state: AttemptState,
  failure: Failure,
  until: number,
  charged: Usage | null,
  extra: readonly PartId[] = [],
): Promise<AttemptState> {
  const next = state.attempt + 1;
  const reason = failure.message;
  const failures = await failedParts(context, [...openParts(state), ...extra], failure);
  let view = state.run;

  await changeRun(
    context,
    state.run.id,
    (record) => {
      view = { ...record.view, attempt: next };

      return {
        record: {
          ...record,
          view,
          retrying: { attempt: next, until, reason },
          usage: charged === null ? record.usage : addUsage(record.usage ?? ZERO, charged),
        },
        event: {
          head: context.head,
          kind: "run",
          run: state.run.id,
          change: "retrying",
          attempt: next,
          until,
          reason,
        },
      };
    },
    failures,
  );

  return fresh(view, 0);
}

/**
 * Lands `loop_end failed`, and `stopped` of a stopping run: fails every part the attempt's current
 * request left open with the failure (`aborted` for a stop; a part the fence already failed is left
 * out), in one set.
 */
async function failOpen(context: Turn, state: AttemptState, failure: Failure): Promise<void> {
  const updates = await failedParts(context, openParts(state), failure);

  if (updates.length > 0) await commit(context.kernel, updates);
}

/** Returns the updates that fail live parts with `part failed`; a part no longer live is left out. */
async function failedParts(
  context: Turn,
  parts: readonly PartId[],
  failure: Failure,
): Promise<readonly RefUpdate[]> {
  const { kernel, session, head } = context;

  const updates = await Promise.all(
    [...new Set(parts)].map(async (part): Promise<readonly RefUpdate[]> => {
      const name = partRef(session, part);
      const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

      if (found === null || found.record.status.kind !== "live") return [];

      return [
        {
          name,
          target: await put(kernel, "part", {
            ...found.record,
            status: { kind: "failed", run: found.record.run, failure },
          }),
          event: { head, kind: "part", part, change: "failed", failure },
        },
      ];
    }),
  );

  return updates.flat();
}

/** Writes the run record through `change` with its event (and `extra` updates) in one set, compare-and-set on the run ref; nothing when `change` returns null or the run is gone. */
async function changeRun(
  context: Turn,
  run: RunId,
  change: (
    record: RunRecord,
  ) => { readonly record: RunRecord; readonly event: RefUpdate["event"] } | null,
  extra: readonly RefUpdate[] = [],
): Promise<void> {
  const { kernel, session } = context;

  await attempt(`Changing run ${run}`, async () => {
    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null) return undefined;
    const next = change(found.record);

    if (next === null) return undefined;

    const outcome = await commit(kernel, [
      ...extra,
      {
        name: found.ref.name,
        target: await put(kernel, "run", next.record),
        expect: found.ref.revision,
        event: next.event,
      },
    ]);

    return outcome.kind === "set" ? undefined : STALE;
  });
}

/**
 * Adds a settled request's usage to the run record's `usage` and bumps its `requests` in the same
 * write as its `request` event (§38v, w). Returns the run's total and the count that write set,
 * what the response's call ids are namespaced by; the usage alone and a count of 0 when the run is
 * gone.
 */
async function charge(
  context: Turn,
  run: RunId,
  usage: Usage,
  event: RefUpdate["event"],
): Promise<{ readonly total: Usage; readonly requests: number }> {
  let charged = { total: usage, requests: 0 };

  await changeRun(context, run, (record) => {
    charged = { total: addUsage(record.usage ?? ZERO, usage), requests: record.requests + 1 };

    return { record: { ...record, usage: charged.total, requests: charged.requests }, event };
  });

  return charged;
}

/** Returns the head's latest compaction material as the request's checkpoint when it was made by the request model's provider identity (§38e), else null. */
async function checkpointOf(
  context: Turn,
  model: Model<Api>,
): Promise<ProviderCheckpointMaterial | null> {
  const { kernel, session, head } = context;

  const latest = await withFold(kernel, session, (state) => {
    const path = pathOf(state.commits, tipOf(state.heads.get(head)?.info.tip ?? START));

    for (const id of [...path].reverse()) {
      const body = state.commits.get(id)?.body;

      if (body?.kind === "compaction") return state.parts.get(body.part)?.state ?? null;
    }

    return null;
  });

  if (latest === null) return null;
  const checked = await check(compaction.state, latest);

  if (checked.kind === "invalid" || checked.value.material === null) return null;
  const material = checked.value.material;

  if (
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

/** Returns a fresh attempt's state for a run view, its next part index given. */
function fresh(run: RunView, index: number): AttemptState {
  return {
    run,
    attempt: run.attempt,
    index,
    opened: [],
    parts: new Map(),
    starts: new Map(),
    merging: null,
  };
}

/** Returns every part the attempt's current request opened. */
function openParts(state: AttemptState): readonly PartId[] {
  return state.opened.map((entry) => entry.part);
}

/** Returns a thinking part's `signature`: its thoughts, or null when none carried a signature and none was redacted. */
function thoughtsOf(thoughts: readonly ThoughtSignature[]): Json {
  return thoughts.some((entry) => entry.signature !== null || entry.redacted)
    ? thoughts.map((entry) => ({ ...entry }))
    : null;
}

/** Returns a JSON value as the provider's mutable JSON. */
function jsonValue(value: Json): JsonValue {
  if (isList(value)) return value.map(jsonValue);

  if (isJsonObject(value))
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, jsonValue(inner)]));

  return value;
}

/** Returns whether a JSON value is an array. */
function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}
