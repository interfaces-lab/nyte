import type { Models } from "@nyte-ai/ai";
import { classifyAssistantFailure } from "@nyte-ai/ai/utils/failure";
import { isContextOverflow, isRecoverableLength } from "@nyte-ai/ai/utils/overflow";
import { abortableSleep, isRetryableAssistantError, retryDelayMs } from "@nyte-ai/ai/utils/retry";
import { asId } from "@nyte-ai/schema";
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
  Usage,
} from "@nyte-ai/schema";
import type {
  Api,
  AssistantMessage,
  Context,
  Failure,
  JsonValue,
  Model,
  ProviderCheckpointMaterial,
} from "@nyte-ai/schema/model";
import { compactIfNeeded } from "./compaction.ts";
import { providerContext, requestBody } from "./context.ts";
import type { HookContext } from "./hooks.ts";
import { check, isJson } from "./json-schema.ts";
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

/** Returns one tool call as the provider streamed it. */
type ModelToolCall = Extract<AssistantMessage["content"][number], { readonly type: "toolCall" }>;

/** Returns one merged thought's share of a thinking part's `signature` (§38f): its length in the part's markdown, so a replay splits the thoughts back, and the provider's `thinkingSignature` and `redacted` for it. */
type ThoughtSignature = {
  readonly length: number;
  readonly signature: string | null;
  readonly redacted: boolean;
};

/** Returns one text or thinking part a request has open: its id, kind, the markdown streamed into it so far, its provider continuity data, and for thinking how many adjacent thoughts it holds. It stays live until the request's stream is done. Settled, a text part's `signature` is `textSignature` and a thinking part's is `thoughts`, or null when no thought carried a signature and none was redacted. */
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
  /** The thinking part the next thought merges into; null once text or a tool call streamed after it. */
  merging: OpenPart | null;
}

/** Returns how one provider request's stream ended, with the usage it was charged. */
type StreamOutcome =
  | {
      readonly kind: "done";
      readonly message: AssistantMessage;
      readonly stop: "stop" | "length" | "toolUse";
      readonly calls: readonly ModelToolCall[];
      readonly usage: Usage;
    }
  | { readonly kind: "overflow"; readonly message: AssistantMessage; readonly usage: Usage }
  | {
      readonly kind: "failed";
      readonly message: AssistantMessage;
      readonly failure: Failure;
      readonly retryable: boolean;
      readonly usage: Usage;
    }
  | { readonly kind: "stopped" };

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

/** Returns the turn driver `advance` runs a run's turn with: what `kernel.turn` holds. `run_started` and `run_ended` are observed by `startRun` and `endRun` once logged (§38q, n); the turn observes neither. A run driven again with live text or thinking parts of its own (the host died mid-stream) fails them and takes the next attempt (`run retrying` with `until` now). Then it loops, one provider request per pass, in the baseline's hook order (§38s): `buildContext` (the run's configuration) → `transform_context` → the run's tools (`kernel.tools(session, run).list()`, narrowed to the agent's `tools` when its configuration's agent names some) → `transcriptOf` → `transform_transcript` → `compactIfNeeded` on the transformed transcript (reason `threshold`; `before_compaction` inside; a compaction rebuilds the body through both transforms again, without compacting twice in one pass) → `before_request` (`ModelRequest { model, thinking, step: "assistant", attempt, options: { sampling: {}, headers: {} } }`; a model the catalog lacks fails the run `runner`) → `run phase responding` (clearing `retrying`) → `models.streamSimple(model, providerContext(...), { signal, reasoning, samplingParams, headers, maxTokens, sessionId })` through `withLimits`, so a response that changed the provider's account limits moves the catalog generation, `reasoning` the request's thinking (none for `"off"`; ai lowers a level through the model's `thinkingLevelMap` and a fast ref to its base with the mode set). Stream events become parts through `createPart` with `run`, `head` and `CORE_CONTEXT`: `text_start` opens a `text` part (placement transcript `answer`, id `${run}:${attempt}:${index}`, `signature` null), `thinking_start` opens a `thinking` part (transcript `step`, `merged` 1, `signature` null) unless it follows a thought, which it merges into (`merged` + 1, first id kept, markdown joined by a blank line); each delta is a `publishPatch` `append`; the parts stay live while the stream runs, and once it is done every part the response opened settles with its final markdown and `signature` (§38f, as `OpenPart` says), each its `part updated`, `part settled` and commit, the commits chained in opening order, all in one set. Tool calls wait for the stream's end. A `done` stream publishes a `request` event (`usageOf(message, info)`, `ContextView { tokens: the reported input, cache and output tokens, window: info.contextWindow, lastRequest }`, step `assistant`) on the run ref, in the same write that adds the usage to the run record's `usage` and bumps its `requests` (§38v, w), and observes `after_request` (step `assistant`, `durationMs`); a length stop that ended short of the output limit (`isRecoverableLength`) is an overflow, its parts left live. An error the policy retries (`isRetryableAssistantError` and `retryDelayMs` from `@nyte-ai/ai/utils/retry`, up to `RETRY_POLICY.maxRetries` per request) fails every part the response opened with the failure, so the next attempt's parts replace them and none of the failed attempt's text reaches the next request, publishes `run retrying { attempt + 1, until: now + retryDelayMs, reason }` with the run record's `retrying` set, its `view.attempt` bumped and the failed request's usage added to its `usage` in the same set (§38t, v), so part ids never repeat after a restart, sleeps until `until` (abortable; after a restart `advance` drives the run once `until` passed, §38o) and repeats the pass at the next attempt; an overflow (`isContextOverflow` from `@nyte-ai/ai/utils/overflow`) runs `compactIfNeeded` with reason `overflow` once per request and repeats as a retry; an abort is `stopped`; any other error, or a retry budget spent, fails the response's parts and ends the run `failed { failure }` (`classifyAssistantFailure` from `@nyte-ai/ai/utils/failure`). With no tool calls `boundary()` lands the inputs that joined meanwhile and the attached ones waiting: when it landed one that is not an attach, the loop runs again in this run (a steer admitted while the final answer streamed joins it, as its `joined { run }` schedule said); an attach lands in the run but never by itself causes a pass (it rides with whatever turn comes next), so with only attaches, or nothing, landed the run ends `completed { usage }`, the run's total: the run record's `usage`, every request the run was charged across parks, re-drives and restarts (compaction's written by `compactIfNeeded`). With calls: `run phase executing`, then each call in response order through `executeCall` (call id, and so tool part id, `${run}:${requests}:${providerCallId}` with `requests` the run record's count as the response's own `request` event wrote it (§38w), so a provider reusing `call_0`, in this run or another, never replays an earlier call; as `LOCAL` with participant authority, the run's signal), each awaited until it settles or parks; a parked call does not hold back the next (§38k), so every call has its step record before the turn returns, and when any parked the turn returns without ending the run (`advance` reports `waiting`, §34d; a later drive resumes after `resume` re-ran it). Then `boundary()` lands joined inputs and the loop runs again. A stopped run (its fence passed, its signal aborted) ends `stopped`, its open parts already failed by the fence; a turn aborted by the host closing returns the same and the driver leaves the run live (§38y). */
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

/** Runs one turn: resumes the attempt, then one provider request per pass until the run ends or a call parks. */
async function turn(
  context: Turn,
  given: RunView,
  boundary: () => Promise<readonly LandedInput[]>,
): Promise<RunEnd> {
  const { kernel, models, session, head, signal } = context;
  const configuration = given.configuration;
  const hooks = kernel.pluginsFor(session).hooks;
  const resumedState = await resumed(context, given);

  if (resumedState === null) return STOPPED;
  let state = resumedState;
  let retries = 0;
  let overflowed = false;

  for (;;) {
    if (stopping(context, given.id)) return STOPPED;
    const info = await modelInfo(kernel, models, configuration.model, session);

    if (info === null) return failed(`No model ${configuration.model.id} is in the catalog.`);
    let body = await requestBody(kernel, models, session, head, state.run, configuration);

    const compacted = await compactIfNeeded(kernel, models, {
      session,
      head,
      run: state.run,
      configuration,
      transcript: body.transcript,
      info,
      reason: "threshold",
      signal,
    });

    if (compacted.kind === "compacted")
      body = await requestBody(kernel, models, session, head, state.run, configuration);

    const request: ModelRequest = await hooks.transform(
      "before_request",
      {
        model: configuration.model,
        thinking: configuration.thinking,
        step: "assistant",
        attempt: state.attempt,
        options: { sampling: {}, headers: {} },
      },
      context.where,
    );

    const model = models.getModel(request.model.provider, request.model.id);
    const requestInfo = await modelInfo(kernel, models, request.model, session);

    if (model === undefined || requestInfo === null)
      return failed(`No model ${request.model.provider}/${request.model.id} is in the catalog.`);

    if (stopping(context, given.id)) return STOPPED;
    await changeRun(context, given.id, (record) =>
      record.phase === "responding" && record.retrying === null
        ? null
        : {
            record: { ...record, phase: "responding", retrying: null },
            event: { head, kind: "run", run: given.id, change: "phase", phase: "responding" },
          },
    );

    const started = Date.now();

    const checkpoint = await checkpointOf(context, model);

    const outcome = await withLimits(kernel, models, model.provider, () =>
      stream(context, state, {
        model,
        info: requestInfo,
        request,
        context: providerContext(body.transcript, body.source, checkpoint),
      }),
    );

    switch (outcome.kind) {
      case "stopped":
        return STOPPED;
      case "failed": {
        if (outcome.retryable && retries < RETRY_POLICY.maxRetries && !signal.aborted) {
          retries += 1;
          const until = Date.now() + retryDelayMs(RETRY_POLICY, retries);
          state = await retry(context, state, outcome.failure, until, outcome.usage);

          if (
            !(await abortableSleep(until - Date.now(), signal).then(
              () => true,
              () => false,
            ))
          )
            return STOPPED;
          continue;
        }

        await failOpen(context, state, outcome.failure);

        return { kind: "failed", failure: outcome.failure };
      }

      case "overflow": {
        const failure: Failure = classifyAssistantFailure(outcome.message);

        const overflow: Failure =
          failure.class === "context_window"
            ? failure
            : { class: "context_window", message: "The response ran out of context." };

        const recovered = overflowed
          ? null
          : await compactIfNeeded(kernel, models, {
              session,
              head,
              run: state.run,
              configuration,
              transcript: body.transcript,
              info,
              reason: "overflow",
              signal,
            });

        overflowed = true;

        if (recovered === null || recovered.kind === "skipped") {
          await failOpen(context, state, overflow);

          return { kind: "failed", failure: overflow };
        }

        state = await retry(context, state, overflow, Date.now(), outcome.usage);
        continue;
      }

      case "done": {
        retries = 0;
        overflowed = false;

        void hooks.observe(
          "after_request",
          {
            model: request.model,
            thinking: request.thinking,
            usage: outcome.usage,
            durationMs: Date.now() - started,
            step: "assistant",
          },
          context.where,
        );

        const { total, requests } = await charge(
          context,
          given.id,
          outcome.usage,
          requestEvent(head, "assistant", outcome.usage, requestInfo),
        );

        if (outcome.calls.length === 0) {
          if ((await boundary()).some((input) => input.delivery !== "attach")) continue;

          return { kind: "completed", usage: total };
        }

        if (stopping(context, given.id)) return STOPPED;
        await changeRun(context, given.id, (record) =>
          record.phase === "executing"
            ? null
            : {
                record: { ...record, phase: "executing" },
                event: { head, kind: "run", run: given.id, change: "phase", phase: "executing" },
              },
        );

        let parked = false;

        for (const call of outcome.calls) {
          if (stopping(context, given.id)) return STOPPED;

          const result = await executeCall(kernel, {
            session,
            head,
            run: given.id,
            call: asId<"call">(`${given.id}:${requests}:${call.id}`),
            name: call.name,
            args: isJson(call.arguments) ? call.arguments : {},
            context: CALLER,
            signal,
          });

          if (result.kind === "parked") parked = true;
        }

        if (stopping(context, given.id)) return STOPPED;

        if (parked) return { kind: "completed", usage: total };
        await boundary();
      }
    }
  }
}

/** Returns the attempt a drive resumes: the run record's, or the next one when the run still has live text or thinking parts of its own (the host died mid-stream), which it fails in the same set as `run retrying` with `until` now; the next part index counts the parts the attempt already made. Null once the run is gone. */
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

/** Streams one provider request into parts and returns how it ended: the parts it opened settle together once it is done and stay live otherwise, for the caller to fail. */
async function stream(
  context: Turn,
  state: AttemptState,
  input: {
    readonly model: Model<Api>;
    readonly info: ModelInfo;
    readonly request: ModelRequest;
    readonly context: Context;
  },
): Promise<StreamOutcome> {
  const { kernel, models, session, signal } = context;
  const run = state.run.id;
  const thought = new Map<number, number>();
  const thinkingLevel = input.request.thinking;
  let final: AssistantMessage | null = null;

  const events = models.streamSimple(input.model, input.context, {
    signal,
    reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
    samplingParams: { ...input.request.options.sampling },
    headers: { ...input.request.options.headers },
    maxTokens: input.info.maxOutput,
    sessionId: session,
  });

  const append = (target: OpenPart, delta: string): void => {
    target.markdown += delta;
    publishPatch(kernel, session, run, { kind: "patch", part: target.part, append: delta });
  };

  try {
    for await (const event of events) {
      if (stopping(context, run)) return { kind: "stopped" };

      switch (event.type) {
        case "text_start": {
          state.merging = null;
          state.parts.set(event.contentIndex, await open(context, state, "text"));
          break;
        }

        case "thinking_start": {
          const merging = state.merging;

          if (merging === null) {
            const opened = await open(context, state, "thinking");
            state.merging = opened;
            state.parts.set(event.contentIndex, opened);
            thought.set(event.contentIndex, 0);
            break;
          }

          merging.merged += 1;
          append(merging, THOUGHTS);
          state.parts.set(event.contentIndex, merging);
          thought.set(event.contentIndex, merging.markdown.length);
          break;
        }

        case "text_delta":
        case "thinking_delta": {
          const found = state.parts.get(event.contentIndex);

          if (found !== undefined) append(found, event.delta);
          break;
        }

        case "text_end": {
          const found = state.parts.get(event.contentIndex);

          if (found === undefined) break;
          const block = event.partial.content[event.contentIndex];
          found.markdown = event.content;
          found.textSignature =
            block?.type === "text" ? (block.textSignature ?? null) : found.textSignature;
          state.parts.delete(event.contentIndex);
          break;
        }

        case "thinking_end": {
          const found = state.parts.get(event.contentIndex);

          if (found === undefined) break;
          const block = event.partial.content[event.contentIndex];
          const start = thought.get(event.contentIndex) ?? 0;
          found.markdown = found.markdown.slice(0, start) + event.content;

          found.thoughts.push({
            length: event.content.length,
            signature: block?.type === "thinking" ? (block.thinkingSignature ?? null) : null,
            redacted: block?.type === "thinking" && block.redacted === true,
          });

          thought.delete(event.contentIndex);
          state.parts.delete(event.contentIndex);
          break;
        }

        case "toolcall_start":
          state.merging = null;
          break;
        case "done":
          final = event.message;
          break;
        case "error":
          final = event.error;
          break;
        default:
          break;
      }
    }
  } catch (error) {
    if (signal.aborted || stopping(context, run)) return { kind: "stopped" };

    throw error;
  }

  if (final === null || stopping(context, run) || final.stopReason === "aborted")
    return { kind: "stopped" };
  const usage = usageOf(final, input.info);

  if (final.stopReason === "error") {
    if (isContextOverflow(final)) return { kind: "overflow", message: final, usage };

    return {
      kind: "failed",
      message: final,
      failure: classifyAssistantFailure(final),
      retryable: isRetryableAssistantError(final),
      usage,
    };
  }

  if (final.stopReason === "length" && isRecoverableLength(final, input.info.maxOutput))
    return { kind: "overflow", message: final, usage };

  for (const [index, pending] of state.parts) {
    const start = thought.get(index);

    if (pending.kind === "thinking" && start !== undefined)
      pending.thoughts.push({
        length: pending.markdown.length - start,
        signature: null,
        redacted: false,
      });
  }

  await settle(context, run, state.opened);
  state.opened.length = 0;
  state.parts.clear();
  state.merging = null;

  const calls = final.content.filter((block): block is ModelToolCall => block.type === "toolCall");

  return {
    kind: "done",
    message: final,
    stop: final.stopReason === "length" ? "length" : calls.length > 0 ? "toolUse" : "stop",
    calls,
    usage,
  };
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

/** Settles the parts a request opened, once its stream is done, with their final markdown and signatures in one set: for each in opening order its `part updated`, `part settled` and commit, each commit the parent of the next; a part no longer live (its run's fence failed it) is left out. */
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

/** Fails every part the attempt's current request opened (and `extra`) and publishes `run retrying { attempt + 1, until, reason }` with the run record's `retrying` set, its `view.attempt` bumped and the failed request's `charged` usage added to its `usage` (§38v), in one set; returns the next attempt's state. */
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

/** Fails every part the attempt's current request opened with a failure, in one set. */
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

/** Adds a settled request's usage to the run record's `usage` and bumps its `requests` in the same write as its `request` event (§38v, w); returns the run's total and the count that write set, what the response's call ids are namespaced by. The usage alone and a count of 0 when the run is gone. */
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
  return { run, attempt: run.attempt, index, opened: [], parts: new Map(), merging: null };
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

/** Returns whether the run's stop fence is passed or its signal aborted. */
function stopping(context: Turn, run: RunId): boolean {
  return context.signal.aborted || context.kernel.runs.isStopping(run);
}

/** Returns a run end that failed the run itself. */
function failed(message: string): RunEnd {
  return { kind: "failed", failure: { class: "runner", message } };
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
