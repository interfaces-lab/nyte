import { asId, isJson, SdkError } from "@nyte-ai/schema";
import type {
  CallId,
  Disposer,
  DurableEvent,
  Failure,
  HeadName,
  Json,
  ModelRef,
  Placement,
  RefUpdate,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  Usage,
} from "@nyte-ai/schema";
import type { Models } from "@nyte-ai/ai";
import type { AssistantMessage, AssistantMessageEvent } from "@nyte-ai/schema/model";
import { CONTINUE_INTERRUPTED } from "../builtins/interruptions.ts";
import { LOCAL, PARTICIPANT_AUTHORITY } from "../contract/host.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type {
  HookContext,
  Kernel,
  LandedInput,
  PluginRuntime,
  TurnDriver,
} from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import type { PartRecord, RunRecord } from "../contract/records.ts";
import { progressMark } from "../drive/interruptions.ts";
import { unpaused } from "../drive/pause.ts";
import { resolveHeadConfiguration } from "../engine/contributions.ts";
import { intendedCall } from "../engine/durable.ts";
import { stopRequested } from "../engine/fence.ts";
import { awaitMcpServers } from "../env/mcp.ts";
import { publishPatch } from "../engine/runs.ts";
import { modelInfo, withLimits } from "../extend/models.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { callRef, kvRef, partRef, runRef } from "../store/refs.ts";
import { attempt, load, put, readKv, STALE } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { agentLoop, INTERRUPTED } from "./agent-loop.ts";
import type {
  FailedResponse,
  LoopConfig,
  LoopEvent,
  ModelToolCall,
  Prepared,
  PreparedRequest,
} from "./agent-loop.ts";
import { compact, failLeftoverCompactions, readProviderCheckpoint } from "./compaction.ts";
import { ABORTED, adopt, keepOpen, savedOpen, settledParts } from "./open-parts.ts";
import type { OpenPart } from "./open-parts.ts";
import { calculateUsage, charge, providerContext, requestEvent, RETRY_POLICY } from "./request.ts";
import { executeCall } from "./tool-runner.ts";
import type { ToolIntent } from "./tool-runner.ts";
import { estimateTranscriptTokens, requestBody } from "./transcript.ts";
import { followedTrace, startSpan, traced } from "../util/trace.ts";
import { ZERO_USAGE } from "../util/usage.ts";

interface AttemptState {
  readonly run: RunView;
  readonly attempt: number;

  index: number;
  readonly opened: OpenPart[];

  readonly parts: Map<number, OpenPart>;

  readonly starts: Map<number, number>;
  merging: OpenPart | null;
  model?: ModelRef;
}

interface Turn {
  readonly kernel: Kernel;
  readonly models: Models;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly signal: AbortSignal;
  readonly where: HookContext;

  readonly holds: { readonly runtime: PluginRuntime; readonly release: Disposer }[];
}

interface TurnRequest extends PreparedRequest {
  readonly runtime: PluginRuntime;
}

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

async function turn(
  context: Turn,
  given: RunView,
  boundary: () => Promise<readonly LandedInput[]>,
): Promise<RunEnd | { readonly kind: "parked" }> {
  const { kernel, models, session, head, signal } = context;
  const run = given.id;
  let state = await resumed(context, given);
  await boundary();
  let charged = { total: ZERO_USAGE, requests: 0 };
  let callIds = new Map<ModelToolCall, CallId>();

  const config: LoopConfig<TurnRequest> = {
    attempt: state.attempt,
    retry: RETRY_POLICY,
    ready: (waiting) => unpaused(kernel, waiting),

    async prepareRequest(asked) {
      const runtime = kernel.plugins.runtime(session);
      context.holds.push({ runtime, release: runtime.hold() });

      const ended = startSpan("turn.start", followedTrace(session), {
        session,
        attempt: asked.attempt,
      });

      try {
        await runtime.ready;
        await awaitMcpServers(kernel, runtime, session, signal);
        const configuration = await resolveHeadConfiguration(kernel, session, head);
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

        if (estimateTranscriptTokens(built.transcript) > configured.compactAt) {
          const compacted = await compacting(built, "threshold");

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
          signal,
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
            await readProviderCheckpoint(kernel, session, head, model),
          ),
          at: Date.now(),
          usage: (message) => calculateUsage(message, model),
          runtime,
        };
      } catch (error) {
        return failedRequest(error instanceof Error ? error.message : String(error));
      } finally {
        ended();
      }
    },

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
      state.model = prepared.info.ref;

      const streamed = startSpan("model.stream", followedTrace(session), {
        session,
        model: prepared.model.id,
      });

      const events = models.streamSimple(prepared.model, prepared.context, {
        signal: AbortSignal.any([signal, kernel.executionState.streams.signal]),
        reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
        samplingParams: { ...prepared.request.options.sampling },
        headers: { ...prepared.request.options.headers },
        maxTokens: prepared.info.maxOutput,
        sessionId: session,
      });

      return {
        events,
        settled: withLimits(kernel, models, prepared.model.provider, async () => {
          try {
            await events.result();
          } finally {
            streamed();
          }
        }),
      };
    },
    tools: {
      execute(call, called) {
        const id = callIds.get(call);

        if (id === undefined)
          throw new SdkError("internal", `Call ${call.id} ran before its response settled.`);

        return traced("tool.run", followedTrace(session), { session, tool: call.name }, () =>
          executeCall(kernel, {
            runtime: context.holds.at(-1)?.runtime ?? kernel.plugins.runtime(session),
            session,
            head,
            run,
            call: id,
            name: call.name,
            args: isJson(call.arguments) ? call.arguments : {},
            argumentsError: call.argumentsError,
            model: state.model,
            context: CALLER,
            signal: called,
          }),
        );
      },
    },

    async settleResponse({ message, calls, usage, prepared }) {
      observe(context, prepared, usage);
      closeThoughts(state);

      await changeRun(context, run, async (record) => {
        const next = charge(record, usage, true);
        const executing = calls.length > 0 && record.phase !== "executing";
        charged = { total: next.usage ?? usage, requests: next.requests };
        callIds = assignCallIds(run, next.requests, message, calls);

        const intents = record.stopping
          ? []
          : await Promise.all(
              [...callIds].map(async ([call, id], position): Promise<RefUpdate> => {
                const intent: ToolIntent = {
                  name: call.name,
                  args: isJson(call.arguments) ? call.arguments : {},
                  principal: CALLER.principal,
                  model: prepared.info.ref,
                  position,
                  ...(call.argumentsError !== undefined && { argumentsError: call.argumentsError }),
                };

                return {
                  name: callRef(session, id),
                  target: await put(
                    kernel.store,
                    "call",
                    intendedCall({ call: id, run, head, intent }),
                  ),
                  expect: "absent",
                };
              }),
            );

        return {
          record: { ...next, response: usage, phase: executing ? "executing" : next.phase },
          events: [
            requestEvent(head, "assistant", usage, prepared.info),
            ...(executing
              ? [{ head, kind: "run", run, change: "phase", phase: "executing" } as const]
              : []),
          ],
          updates: [...(await settledParts(context, state.opened)), ...intents],
        };
      });

      state.opened.length = 0;
      state.parts.clear();
      state.starts.clear();
      state.merging = null;
    },
    boundary: () => boundary(),
  };

  const land = async (event: LoopEvent<TurnRequest>): Promise<void> => {
    switch (event.type) {
      case "message_start":
        return opened(context, state, event.kind, event.index);
      case "message_update":
        return updated(context, state, event.event);
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
    case "stopped": {
      const stopping = await stopRequested(kernel.store, session, run);

      await closeOpen(
        context,
        run,
        () =>
          stopping ? keepOpen(context, state.opened, ABORTED) : savedOpen(context, state.opened),
        end.response,
      );

      return STOPPED;
    }

    case "failed":
      await closeOpen(
        context,
        run,
        () => keepOpen(context, state.opened, end.failure),
        end.response,
      );

      return { kind: "failed", failure: end.failure };
  }
}

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

async function updated(
  context: Turn,
  state: AttemptState,
  event: AssistantMessageEvent,
): Promise<void> {
  if (context.kernel.runs.fenced(state.run.id)) return;

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

/** Ends the thinking blocks a response left open, so each keeps its length in the part's signature. */
function closeThoughts(state: AttemptState): void {
  for (const [index, pending] of state.parts) {
    const start = state.starts.get(index);

    if (pending.kind === "thinking" && start !== undefined)
      pending.thoughts.push({
        length: pending.markdown.length - start,
        signature: null,
        redacted: false,
      });
  }
}

function append(context: Turn, state: AttemptState, target: OpenPart, delta: string): void {
  target.markdown += delta;
  target.version += 1;
  publishPatch(context.kernel, context.session, state.run.id, {
    kind: "patch",
    part: target.part,
    append: delta,
  });
}

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

async function resumed(context: Turn, run: RunView): Promise<AttemptState> {
  const { kernel, session, head } = context;
  await failLeftoverCompactions(kernel, session, head, run.id);

  const orphans = await withFold(kernel, session, (state) =>
    [...state.parts.values()].filter(
      (part) =>
        part.run === run.id &&
        part.status.kind === "live" &&
        (part.partKind === "text" || part.partKind === "thinking"),
    ),
  );

  const current = fresh(run, 0);

  const state =
    orphans.length === 0
      ? current
      : await retry(
          context,
          current,
          INTERRUPTED,
          Date.now(),
          null,
          await Promise.all(orphans.map(adopt)),
        );

  const prefix = `${run.id}:a${state.attempt}:`;

  state.index = await withFold(
    kernel,
    session,
    (folded) => [...folded.parts.keys()].filter((id) => id.startsWith(prefix)).length,
  );

  return state;
}

async function open(context: Turn, state: AttemptState, kind: OpenPart["kind"]): Promise<OpenPart> {
  const { kernel, session, head } = context;
  const run = state.run.id;
  const part = asId<"part">(`${run}:a${state.attempt}:${state.index}`);
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
    model: state.model,
  };

  const live = await commit(
    kernel,
    [
      {
        name: partRef(session, part),
        target: await put(kernel.store, "part", record),
        expect: "absent",
        events: [
          {
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
            model: state.model,
          },
        ],
      },
    ],
    { session, run },
  );

  const opened: OpenPart = {
    part,
    kind,
    markdown: "",
    version: 1,
    merged: 1,
    textSignature: null,
    thoughts: [],
  };

  if (live.kind === "set") state.opened.push(opened);

  return opened;
}

/** Response-scoped call ids: the provider's id, made unique within the response, under the run and the response's request count. */
function assignCallIds(
  run: RunId,
  requests: number,
  message: AssistantMessage,
  calls: readonly ModelToolCall[],
): Map<ModelToolCall, CallId> {
  const seen = new Set<string>();

  return new Map(
    calls.map((call) => {
      const index = message.content.findIndex((block) => block === call);
      let id = call.id;

      while (id === "" || seen.has(id)) id = `${id === "" ? "call" : id}_${index}`;
      seen.add(id);

      return [call, asId<"call">(`${run}:${requests}:${id}`)];
    }),
  );
}

/**
 * Moves the run to its next attempt. The parts the cut-off response left open, with the ones a
 * previous driver left live (`adopted`), fail; with `continueInterrupted` on, its text that
 * already streamed settles instead, and the transcript asks the model to continue from it.
 * Thinking always fails: a thought cut off has no signature to replay it with. The text kept is
 * no progress toward the restart cap, so the run's interruption mark moves past it.
 */
async function retry(
  context: Turn,
  state: AttemptState,
  failure: Failure,
  until: number,
  charged: FailedResponse<TurnRequest> | null,
  adopted: readonly OpenPart[] = [],
): Promise<AttemptState> {
  const { kernel, session, head } = context;

  if (charged !== null) observe(context, charged.prepared, charged.usage);
  const next = state.attempt + 1;
  const reason = failure.message;
  const run = state.run.id;
  const cut = [...state.opened, ...adopted];

  const continuing =
    failure.class !== "context_window" &&
    (await readKv(kernel.store, kvRef("host", "settings", CONTINUE_INTERRUPTED))) !== false;

  const kept = continuing
    ? cut.filter((entry) => entry.kind === "text" && entry.markdown.trim() !== "")
    : [];

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
      updates: [
        ...(await settledParts(context, kept)),
        ...(await keepOpen(
          context,
          cut.filter((entry) => !kept.includes(entry)),
          failure,
        )),
      ],
    };
  });

  if (retried !== null && kept.length > 0)
    await changeRun(context, run, async (record) =>
      record.interrupted === undefined
        ? null
        : {
            record: {
              ...record,
              interrupted: {
                ...record.interrupted,
                mark: await progressMark(kernel.store, session, head, run),
              },
            },
            events: [],
          },
    );

  return retried === null ? state : fresh(retried, 0);
}

async function closeOpen(
  context: Turn,
  run: RunId,
  updates: () => Promise<readonly RefUpdate[]>,
  response: FailedResponse<TurnRequest> | null,
): Promise<void> {
  const { kernel, head } = context;

  if (response === null)
    return attempt(`Closing the parts of run ${run}`, async () => {
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

async function changeRun(
  context: Turn,
  run: RunId,
  change: (record: RunRecord) => Promise<RunChange | null>,
): Promise<void> {
  const { kernel, session } = context;

  return attempt(`Changing run ${run}`, async () => {
    const found = await load(
      kernel.store,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null) throw new SdkError("internal", `Run ${run} has no record.`);
    const next = await change(found.record);

    if (next === null) return undefined;
    const target = await put(kernel.store, "run", next.record);
    const outcome = await commit(kernel, [
      ...(next.updates ?? []),
      { name: found.ref.name, target, expect: found.ref.revision, events: next.events },
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
