import type { Models } from "@nyte-ai/ai";
import { asId, isJson } from "@nyte-ai/schema";
import type {
  DurableEvent,
  HeadName,
  Json,
  PartId,
  Placement,
  RefUpdate,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  Usage,
} from "@nyte-ai/schema";
import type { AssistantMessageEvent, Failure } from "@nyte-ai/schema/model";
import { agentLoop } from "./agent-loop.ts";
import type {
  FailedResponse,
  LoopConfig,
  LoopEvent,
  Prepared,
  PreparedRequest,
} from "./agent-loop.ts";
import { checkpointOf, compactIfNeeded } from "./compaction.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { HookContext } from "./hooks.ts";
import type { Kernel, LandedInput, TurnDriver } from "./kernel.ts";
import { modelInfo, withLimits } from "./models.ts";
import { createPart } from "./part-handle.ts";
import { text, thinking } from "./parts.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import { CORE_CONTEXT, LOCAL, PARTICIPANT_AUTHORITY } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodePartRecord, decodeRunRecord } from "./records.ts";
import type { RunRecord } from "./records.ts";
import { partRef, runRef } from "./refs.ts";
import {
  RETRY_POLICY,
  ZERO_USAGE,
  charge,
  providerContext,
  requestEvent,
  usageOf,
} from "./request.ts";
import { publishPatch } from "./runs.ts";
import { STALE, attempt, commit, expectOf, load, put, readTip, withFold } from "./session-state.ts";
import { executeCall } from "./tool-runner.ts";
import { failParts, failedParts, requestBody, settling, tokenEstimate } from "./transcript.ts";

/** Returns one merged thought's share of a thinking part's `signature` (§38f). */
type ThoughtSignature = {
  readonly length: number;
  readonly signature: string | null;
  readonly redacted: boolean;
};

/** Returns one text or thinking part a request has open, live until the request's stream is done. */
interface OpenPart {
  readonly part: PartId;
  readonly kind: "text" | "thinking";
  markdown: string;
  merged: number;
  textSignature: string | null;
  readonly thoughts: ThoughtSignature[];
}

/** Returns what one attempt of a run holds in memory while its requests stream. */
interface AttemptState {
  readonly run: RunView;
  readonly attempt: number;
  /** The index of the attempt's next text or thinking part, `${run}:${attempt}:${index}`. */
  index: number;
  readonly opened: OpenPart[];
  /** The parts still streaming, by the provider's content index. */
  readonly parts: Map<number, OpenPart>;
  /** Where each thought still streaming starts in its part's markdown, by content index. */
  readonly starts: Map<number, number>;
  merging: OpenPart | null;
}

interface Turn {
  readonly kernel: Kernel;
  readonly models: Models;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly signal: AbortSignal;
  readonly where: HookContext;
}

/** Returns a prepared request with the runtime it was built on, which observes its `after_request`. */
interface TurnRequest extends PreparedRequest {
  readonly runtime: PluginRuntime;
}

/** Returns a run record change: the record, its events on the run ref, and updates landing in the same set. */
interface RunChange {
  readonly record: RunRecord;
  readonly events: readonly DurableEvent[];
  readonly updates?: readonly RefUpdate[];
}

const ANSWER: Placement = { kind: "transcript", role: "answer" };

const STEP: Placement = { kind: "transcript", role: "step" };

const THOUGHTS = "\n\n";

const STOPPED: RunEnd = { kind: "stopped" };

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

/**
 * Returns the turn driver `advance` runs a run's turn with, the adapter between the kernel and
 * `agentLoop` (§45d). `done` ends `completed` with the run record's usage, `parked` leaves the run
 * live for `advance` (§34d); `stopped` fails the open parts with `aborted` when the run is stopping.
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

/** Runs one turn: resumes the attempt, runs `agentLoop` from it over the kernel's config, and lands its events. */
async function turn(
  context: Turn,
  given: RunView,
  boundary: () => Promise<readonly LandedInput[]>,
): Promise<RunEnd | { readonly kind: "parked" }> {
  const { kernel, models, session, head, signal } = context;
  const run = given.id;
  const configuration = given.configuration;
  let state = await resumed(context, given);
  let charged = { total: ZERO_USAGE, requests: 0 };

  const config: LoopConfig<TurnRequest> = {
    attempt: state.attempt,
    retry: RETRY_POLICY,
    /** Builds one request on the session's runtime once it is ready, in the baseline's hook order (§38s), any failure failing the request rather than the loop. */
    async prepareRequest(asked) {
      try {
        const runtime = kernel.pluginsFor(session);
        await runtime.ready;
        const configured = await modelInfo(kernel, models, configuration.model, runtime);

        if (configured === null)
          return failedRequest(`No model ${configuration.model.id} is in the catalog.`);
        const input = { session, head, run: state.run, configuration };
        const body = () => requestBody(kernel, models, runtime, input);

        const compact = (
          built: Awaited<ReturnType<typeof body>>,
          reason: "threshold" | "overflow",
        ) =>
          compactIfNeeded(kernel, models, runtime, {
            ...input,
            transcript: built.transcript,
            info: configured,
            reason,
            signal,
          });

        let built = await body();

        if (asked.overflow !== null) {
          const recovered = await compact(built, "overflow");

          if (recovered.kind === "failed") return recovered;

          if (recovered.kind === "skipped") return { kind: "failed", failure: asked.overflow };
          built = await body();
        }

        if (tokenEstimate(built.transcript) > configured.compactAt) {
          const compacted = await compact(built, "threshold");

          if (compacted.kind === "failed") return compacted;

          if (compacted.kind === "compacted") built = await body();
        }

        const request = await runtime.hooks.transform(
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
        const info = await modelInfo(kernel, models, request.model, runtime);

        if (model === undefined || info === null)
          return failedRequest(
            `No model ${request.model.provider}/${request.model.id} is in the catalog.`,
          );

        return {
          kind: "request",
          request,
          model,
          info,
          context: providerContext(
            built.transcript,
            built.source,
            await checkpointOf(kernel, session, head, model),
          ),
          at: Date.now(),
          usage: (message) => usageOf(message, info),
          runtime,
        };
      } catch (error) {
        return failedRequest(error instanceof Error ? error.message : String(error));
      }
    },
    /** Sets `run phase responding` and sends the request; settled once `withLimits` saw its result. */
    async stream(prepared) {
      await changeRun(context, run, async (record) =>
        record.phase === "responding" && record.retrying === null
          ? null
          : {
              record: { ...record, phase: "responding", retrying: null },
              events: [{ head, kind: "run", run, change: "phase", phase: "responding" }],
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
      /** Runs the call through the durable `executeCall`, its id `${run}:${requests}:${providerCallId}` (§38w). */
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
    /** Observes `after_request` on the request's runtime, charges the response with its `request` event (§38v, w), and sets `run phase executing` when it has calls. */
    async finishTurn({ calls, usage, prepared }) {
      observe(context, prepared, usage);

      await changeRun(context, run, async (record) => {
        const next = charge(record, usage, true);
        const executing = calls.length > 0 && record.phase !== "executing";
        charged = { total: next.usage ?? usage, requests: next.requests };

        return {
          record: executing ? { ...next, phase: "executing" } : next,
          events: [
            requestEvent(head, "assistant", usage, prepared.info),
            ...(executing
              ? [{ head, kind: "run", run, change: "phase", phase: "executing" } as const]
              : []),
          ],
        };
      });
    },
    boundary: () => boundary(),
  };

  const land = async (event: LoopEvent<TurnRequest>): Promise<void> => {
    switch (event.type) {
      case "message_start":
        return opened(context, state, event.kind, event.index);
      case "message_update":
        return updated(context, state, event.event);
      case "message_end":
        return settled(context, state);
      case "turn_retry":
        state = await retry(context, state, event.failure, event.until, event.response);

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
      return { kind: "completed", usage: charged.total };
    case "parked":
      return { kind: "parked" };
    case "stopped":
      if (kernel.runs.isStopping(run)) await failOpen(context, state, ABORTED, null);

      return STOPPED;
    case "failed":
      await failOpen(context, state, end.failure, end.response);

      return { kind: "failed", failure: end.failure };
  }
}

/** Lands `message_start`: text opens a `text` part, a thought opens a `thinking` part or merges into the one before it, a tool call ends the merge. */
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

/** Lands `message_update`: a delta is an `append` patch on its part, a block's end sets the part's final markdown and signature (§38f). */
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

/** Lands `message_end`: closes the thoughts still streaming and settles every part the response opened in one set. */
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

function append(context: Turn, state: AttemptState, target: OpenPart, delta: string): void {
  target.markdown += delta;
  publishPatch(context.kernel, context.session, state.run.id, {
    kind: "patch",
    part: target.part,
    append: delta,
  });
}

/** Observes `after_request` for one response on the runtime its request was built on. */
function observe(context: Turn, prepared: TurnRequest, usage: Usage): void {
  const { request } = prepared;

  void prepared.runtime.hooks.observe(
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
}

function failedRequest(message: string): Prepared<TurnRequest> {
  return { kind: "failed", failure: { class: "runner", message } };
}

/** Returns the attempt a drive resumes: the run's, or the next one when the run still has live text or thinking parts (the host died mid-stream), failed with `run retrying`. */
async function resumed(context: Turn, run: RunView): Promise<AttemptState> {
  const { kernel, session } = context;

  const orphans = await withFold(kernel, session, (state) =>
    [...state.parts.values()].flatMap((part) =>
      part.run === run.id &&
      part.status.kind === "live" &&
      (part.partKind === "text" || part.partKind === "thinking")
        ? [part.id]
        : [],
    ),
  );

  const current = fresh(run, 0);

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

/** Settles the parts a request opened in one set, each with its `part updated`, `part settled` and commit; a part its run's fence failed is left out. */
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

      const settledState: Json =
        entry.kind === "text"
          ? { markdown: entry.markdown, signature: entry.textSignature }
          : {
              markdown: entry.markdown,
              merged: entry.merged,
              signature: entry.thoughts.some(
                (thought) => thought.signature !== null || thought.redacted,
              )
                ? entry.thoughts.map((thought) => ({ ...thought }))
                : null,
            };

      const version = found.record.version + 1;

      const landed = await settling(kernel, {
        session,
        head,
        run,
        parent,
        expect: index === 0 ? expectOf(tip.ref) : undefined,
        record: { ...found.record, state: settledState, version },
        body: { kind: "part", part: entry.part },
        at,
      });

      updates.push(
        {
          name,
          target: landed.target,
          expect: found.ref.revision,
          event: {
            head,
            kind: "part",
            part: entry.part,
            change: "updated",
            state: settledState,
            version,
          },
        },
        ...landed.updates,
      );
      parent = landed.landed;
    }

    return (await commit(kernel, updates)).kind === "set" ? undefined : STALE;
  });
}

/** Lands `turn_retry` and a resumed run's orphans in one set: the parts failed as read, `run retrying` and the failed request's charge (§38t, v, w). Once the run is stopping only the charge lands; the stop fails the parts. */
async function retry(
  context: Turn,
  state: AttemptState,
  failure: Failure,
  until: number,
  charged: FailedResponse<TurnRequest> | null,
  extra: readonly PartId[] = [],
): Promise<AttemptState> {
  const { kernel, session, head } = context;

  if (charged !== null) observe(context, charged.prepared, charged.usage);
  const next = state.attempt + 1;
  const reason = failure.message;
  const run = state.run.id;
  let retried: RunView | null = null;

  await changeRun(context, run, async (record) => {
    const paid = charge(record, charged?.usage ?? null, charged !== null);

    const request =
      charged === null
        ? []
        : [requestEvent(head, "assistant", charged.usage, charged.prepared.info)];

    retried = null;

    if (record.stopping) return request.length === 0 ? null : { record: paid, events: request };
    const view = { ...record.view, attempt: next };
    retried = view;

    return {
      record: { ...paid, view, retrying: { attempt: next, until, reason } },
      events: [
        { head, kind: "run", run, change: "retrying", attempt: next, until, reason },
        ...request,
      ],
      updates: await failedParts(kernel, session, head, [...openParts(state), ...extra], failure),
    };
  });

  return retried === null ? state : fresh(retried, 0);
}

/** Lands `loop_end failed`, and `stopped` of a stopping run, in one set: the parts the request left open failed, and the response the loop failed on charged and observed on its request's runtime (§38v, w). */
async function failOpen(
  context: Turn,
  state: AttemptState,
  failure: Failure,
  response: FailedResponse<TurnRequest> | null,
): Promise<void> {
  const { kernel, session, head } = context;

  if (response === null) return failParts(kernel, session, head, openParts(state), failure);
  observe(context, response.prepared, response.usage);

  await changeRun(context, state.run.id, async (record) => ({
    record: charge(record, response.usage, true),
    events: [requestEvent(head, "assistant", response.usage, response.prepared.info)],
    updates: await failedParts(kernel, session, head, openParts(state), failure),
  }));
}

/** Writes the run record through `change`, compare-and-set on the run ref; resolves whether it wrote. */
async function changeRun(
  context: Turn,
  run: RunId,
  change: (record: RunRecord) => Promise<RunChange | null>,
): Promise<boolean> {
  const { kernel, session } = context;

  return attempt(`Changing run ${run}`, async () => {
    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null) throw new SdkError("internal", `Run ${run} has no record.`);
    const next = await change(found.record);

    if (next === null) return false;
    const target = await put(kernel, "run", next.record);
    const [first, ...rest] = next.events;

    const outcome = await commit(kernel, [
      ...(next.updates ?? []),
      { name: found.ref.name, target, expect: found.ref.revision, event: first },
      ...rest.map((event) => ({ name: found.ref.name, target, event })),
    ]);

    return outcome.kind === "set" ? true : STALE;
  });
}

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

function openParts(state: AttemptState): readonly PartId[] {
  return state.opened.map((entry) => entry.part);
}
