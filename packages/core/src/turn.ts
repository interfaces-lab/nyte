import type { Models } from "@nyte-ai/ai";
import { asId, isJson } from "@nyte-ai/schema";
import type {
  Disposer,
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
import { checkpointOf, compact } from "./compaction.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { HookContext } from "./hooks.ts";
import type { Kernel, LandedInput, TurnDriver } from "./kernel.ts";
import { modelInfo, withLimits } from "./models.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import { LOCAL, PARTICIPANT_AUTHORITY } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodePartRecord, decodeRunRecord } from "./records.ts";
import type { PartRecord, RunRecord } from "./records.ts";
import { partRef, runRef } from "./refs.ts";
import {
  RETRY_POLICY,
  ZERO_USAGE,
  charge,
  providerContext,
  requestEvent,
  usageOf,
} from "./request.ts";
import { abortHere, publishPatch, unfenced } from "./runs.ts";
import { STALE, attempt, commit, expectOf, load, put, readTip, withFold } from "./session-state.ts";
import type { Found } from "./session-state.ts";
import { executeCall } from "./tool-runner.ts";
import { failedParts, requestBody, settling, tokenEstimate } from "./transcript.ts";

/** Returns one merged thought's share of a thinking part's `signature`. */
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
  /** The runtimes the turn's requests hold, the latest last: each from its preparation until a later request streams, the turn's signal aborts or the turn ends. */
  readonly holds: { readonly runtime: PluginRuntime; readonly release: Disposer }[];
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
 * `agentLoop`. `done` ends `completed` with the run record's usage, `parked` leaves the run
 * live for `advance`; `stopped` fails the open parts with `aborted` when the run is stopping.
 */
export function createTurnDriver(kernel: Kernel, models: Models): TurnDriver {
  return {
    async run(input) {
      const holds: Turn["holds"][number][] = [];

      const release = (): void => {
        for (const held of holds.splice(0)) held.release();
      };

      input.signal.addEventListener("abort", release, { once: true });

      try {
        return await turn(
          {
            kernel,
            models,
            session: input.session,
            head: input.head,
            signal: input.signal,
            where: {
              session: input.session,
              head: input.head,
              run: input.run.id,
              principal: LOCAL,
            },
            holds,
          },
          input.run,
          () => input.boundary(),
        );
      } finally {
        input.signal.removeEventListener("abort", release);
        release();
      }
    },
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
    /** Builds one request on the session's runtime, held from here, once it is ready, in the baseline's hook order, any failure failing the request rather than the loop. */
    async prepareRequest(asked) {
      const runtime = kernel.pluginsFor(session);
      context.holds.push({ runtime, release: runtime.hold() });

      try {
        await runtime.ready;
        const configured = modelInfo(models, configuration.model, runtime);

        if (configured === null)
          return failedRequest(`No model ${configuration.model.id} is in the catalog.`);
        const input = { session, head, run: state.run, configuration };
        const body = () => requestBody(kernel, models, runtime, input);

        const compacting = (
          built: Awaited<ReturnType<typeof body>>,
          reason: "threshold" | "overflow",
        ) =>
          compact(kernel, models, runtime, {
            ...input,
            transcript: built.transcript,
            info: configured,
            reason,
            signal,
          });

        let built = await body();

        if (asked.overflow !== null) {
          const recovered = await compacting(built, "overflow");

          if (recovered.kind === "failed") return recovered;

          if (recovered.kind === "skipped") return { kind: "failed", failure: asked.overflow };
          built = await body();
        }

        if (tokenEstimate(built.transcript) > configured.compactAt) {
          const compacted = await compacting(built, "threshold");

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
        const info = modelInfo(models, request.model, runtime);

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
    /** Releases the runtimes earlier requests hold, their responses observed and their calls done, sets `run phase responding` and sends the request; settled once `withLimits` saw its result. */
    async stream(prepared) {
      for (const held of context.holds.splice(0, context.holds.length - 1)) held.release();

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
      /** Runs the call through the durable `executeCall` on its response's runtime, its id `${run}:${requests}:${providerCallId}`. */
      execute: (call, called) =>
        executeCall(kernel, {
          runtime: context.holds.at(-1)?.runtime ?? kernel.pluginsFor(session),
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
    /** Observes `after_request` on the request's runtime, charges the response with its `request` event, and sets `run phase executing` when it has calls. */
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
      if (kernel.runs.isStopping(run) || end.response !== null)
        await failOpen(context, state, ABORTED, end.response);

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

/** Lands `message_update`: a delta is an `append` patch on its part, a block's end sets the part's final markdown and signature. Once the run is stopping nothing more lands, so a stopped part keeps the text it streamed. */
async function updated(
  context: Turn,
  state: AttemptState,
  event: AssistantMessageEvent,
): Promise<void> {
  if (context.kernel.runs.isStopping(state.run.id)) return;

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
/** Opens a text or thinking part for the attempt's next index, live in the run, in one set with the run ref as read (`unfenced`), and adds it to the request's `opened`. A run fenced first gets no part and is aborted here, so the loop ends stopped. */
async function open(context: Turn, state: AttemptState, kind: OpenPart["kind"]): Promise<OpenPart> {
  const { kernel, session, head } = context;
  const run = state.run.id;
  const part = asId<"part">(`${run}:${state.attempt}:${state.index}`);
  state.index += 1;
  const placement = kind === "text" ? ANSWER : STEP;

  const initial: Json =
    kind === "text"
      ? { markdown: "", signature: null }
      : { markdown: "", merged: 1, signature: null };

  const record: PartRecord = {
    id: part,
    partKind: kind,
    placement,
    state: initial,
    version: 1,
    owner: null,
    run,
    status: { kind: "live", run },
  };

  const live = await attempt(`Opening part ${part}`, async () => {
    const held = await unfenced(kernel, session, run);

    if (held === null) return false;

    const outcome = await commit(kernel, [
      held,
      {
        name: partRef(session, part),
        target: await put(kernel, "part", record),
        expect: "absent",
        event: {
          head,
          kind: "part",
          part,
          change: "created",
          partKind: kind,
          placement,
          state: initial,
          version: 1,
          run,
          owner: null,
        },
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });

  const opened: OpenPart = {
    part,
    kind,
    markdown: "",
    merged: 1,
    textSignature: null,
    thoughts: [],
  };

  if (live) state.opened.push(opened);
  else abortHere(kernel, run);

  return opened;
}

/** Settles the parts a request opened in one set, each with its `part updated`, `part settled` and commit; a part its run's fence failed keeps what it streamed instead. */
async function settle(context: Turn, run: RunId, opened: readonly OpenPart[]): Promise<void> {
  const { kernel, session, head } = context;

  if (opened.length === 0) return;

  await attempt(`Settling the parts of run ${run}`, async () => {
    const [found, tip] = await Promise.all([
      Promise.all(opened.map(async (entry) => ({ entry, found: await readPart(context, entry) }))),
      readTip(kernel, session, head),
    ]);

    const at = Date.now();
    const updates: RefUpdate[] = [];
    let parent = tip.id;

    for (const { entry, found: part } of found) {
      if (part === null || part.record.status.kind === "settled") continue;

      if (part.record.status.kind !== "live") {
        updates.push(...(await keep(context, entry, part, ABORTED)));

        continue;
      }

      const state = stateOf(entry);
      const version = part.record.version + 1;

      const landed = await settling(kernel, {
        session,
        head,
        run,
        parent,
        expect: parent === tip.id ? expectOf(tip.ref) : undefined,
        record: { ...part.record, state, version },
        body: { kind: "part", part: entry.part },
        at,
      });

      updates.push(
        {
          name: partRef(session, entry.part),
          target: landed.target,
          expect: part.ref.revision,
          event: { head, kind: "part", part: entry.part, change: "updated", state, version },
        },
        ...landed.updates,
      );
      parent = landed.landed;
    }

    return updates.length === 0 || (await commit(kernel, updates)).kind === "set"
      ? undefined
      : STALE;
  });
}

/** Returns the state an open part settles or fails with: its markdown as streamed, with its signatures. */
function stateOf(entry: OpenPart): Json {
  if (entry.kind === "text") return { markdown: entry.markdown, signature: entry.textSignature };

  return {
    markdown: entry.markdown,
    merged: entry.merged,
    signature: entry.thoughts.some((thought) => thought.signature !== null || thought.redacted)
      ? entry.thoughts.map((thought) => ({ ...thought }))
      : null,
  };
}

/** Reads an open part's record. */
async function readPart(context: Turn, entry: OpenPart): Promise<Found<PartRecord> | null> {
  const { kernel, session } = context;

  return load(kernel, await kernel.store.refs.get(partRef(session, entry.part)), decodePartRecord);
}

/** Returns the updates keeping what an open part streamed on its unsettled record: `part updated` with its streamed state, then `part failed` with `failure` while it is still live. */
async function keep(
  context: Turn,
  entry: OpenPart,
  found: Found<PartRecord>,
  failure: Failure,
): Promise<readonly RefUpdate[]> {
  const { kernel, session, head } = context;
  const { record } = found;
  const name = partRef(session, entry.part);
  const part = entry.part;
  const state = stateOf(entry);
  const version = record.version + 1;
  const live = record.status.kind === "live" || record.status.kind === "waiting";
  const status = live ? { kind: "failed", run: record.run, failure } : record.status;
  const target = await put(kernel, "part", { ...record, state, version, status });

  return [
    {
      name,
      target,
      expect: found.ref.revision,
      event: { head, kind: "part", part, change: "updated", state, version },
    },
    ...(live
      ? [{ name, target, event: { head, kind: "part", part, change: "failed", failure } } as const]
      : []),
  ];
}

/** Lands `turn_retry` and a resumed run's orphans in one set: the parts failed as read, `run retrying` and the failed request's charge. Once the run is stopping only the charge lands; the stop fails the parts. */
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
      record: { ...paid, view, retrying: { until, reason } },
      events: [
        { head, kind: "run", run, change: "retrying", attempt: next, until, reason },
        ...request,
      ],
      updates: await failedParts(kernel, session, head, [...openParts(state), ...extra], failure),
    };
  });

  return retried === null ? state : fresh(retried, 0);
}

/** Lands `loop_end failed`, and `stopped` of a stopping run, in one set: the parts the request left open failed with what they streamed, and the response the loop failed on charged and observed on its request's runtime. */
async function failOpen(
  context: Turn,
  state: AttemptState,
  failure: Failure,
  response: FailedResponse<TurnRequest> | null,
): Promise<void> {
  const { kernel, head } = context;
  const run = state.run.id;

  const updates = async () => {
    const failed = await Promise.all(
      state.opened.map(async (entry) => {
        const found = await readPart(context, entry);

        return found === null || found.record.status.kind === "settled"
          ? []
          : keep(context, entry, found, failure);
      }),
    );

    return failed.flat();
  };

  if (response === null)
    return attempt(`Failing the parts of run ${run}`, async () => {
      const failed = await updates();

      return failed.length === 0 || (await commit(kernel, failed)).kind === "set"
        ? undefined
        : STALE;
    });

  observe(context, response.prepared, response.usage);

  await changeRun(context, run, async (record) => ({
    record: charge(record, response.usage, true),
    events: [requestEvent(head, "assistant", response.usage, response.prepared.info)],
    updates: await updates(),
  }));
}

/** Writes the run record through `change`, compare-and-set on the run ref; a null change writes nothing. */
async function changeRun(
  context: Turn,
  run: RunId,
  change: (record: RunRecord) => Promise<RunChange | null>,
): Promise<void> {
  const { kernel, session } = context;

  return attempt(`Changing run ${run}`, async () => {
    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null) throw new SdkError("internal", `Run ${run} has no record.`);
    const next = await change(found.record);

    if (next === null) return undefined;
    const target = await put(kernel, "run", next.record);
    const [first, ...rest] = next.events;

    const outcome = await commit(kernel, [
      ...(next.updates ?? []),
      { name: found.ref.name, target, expect: found.ref.revision, event: first },
      ...rest.map((event) => ({ name: found.ref.name, target, event })),
    ]);

    return outcome.kind === "set" ? undefined : STALE;
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
