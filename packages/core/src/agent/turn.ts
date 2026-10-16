import { asId, isJson } from "@nyte-ai/schema";
import type {
  CallId,
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
import type { Models } from "@nyte-ai/ai";
import type { AssistantMessage, AssistantMessageEvent, Failure } from "@nyte-ai/schema/model";
import { LOCAL, PARTICIPANT_AUTHORITY } from "../contract/host.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type {
  HookContext,
  Kernel,
  LandedInput,
  PluginRuntime,
  TurnDriver,
} from "../contract/kernel.ts";
import { decodePartRecord, decodeRunRecord } from "../contract/records.ts";
import type { PartRecord, RunRecord } from "../contract/records.ts";
import { intendedCall } from "../engine/durable.ts";
import { abortHere, stopRequested, unfenced } from "../engine/fence.ts";
import { awaitMcpServers } from "../env/mcp.ts";
import { publishPatch } from "../engine/runs.ts";
import { modelInfo, withLimits } from "../extend/models.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { failedParts, settling } from "../store/parts.ts";
import { callRef, partRef, runRef } from "../store/refs.ts";
import { attempt, load, put, readRefExpectation, readTip, STALE } from "../store/session.ts";
import type { Found } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { SdkError } from "../util/error.ts";
import { agentLoop } from "./agent-loop.ts";
import type {
  FailedResponse,
  LoopConfig,
  LoopEvent,
  ModelToolCall,
  Prepared,
  PreparedRequest,
} from "./agent-loop.ts";
import { compact, failLeftoverCompactions, readProviderCheckpoint } from "./compaction.ts";
import {
  calculateUsage,
  charge,
  providerContext,
  requestEvent,
  RETRY_POLICY,
  ZERO_USAGE,
} from "./request.ts";
import { executeCall } from "./tool-runner.ts";
import type { ToolIntent } from "./tool-runner.ts";
import { estimateTranscriptTokens, requestBody, withReportedUsage } from "./transcript.ts";

type ThoughtSignature = {
  readonly length: number;
  readonly signature: string | null;
  readonly redacted: boolean;
};

interface OpenPart {
  readonly part: PartId;
  readonly kind: "text" | "thinking";
  markdown: string;
  merged: number;
  textSignature: string | null;
  readonly thoughts: ThoughtSignature[];
}

interface AttemptState {
  readonly run: RunView;
  readonly attempt: number;

  index: number;
  readonly opened: OpenPart[];

  readonly parts: Map<number, OpenPart>;

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

const ABORTED: Failure = { class: "aborted", message: "The run was stopped." };

const ORPHANED: Failure = {
  class: "runner",
  message: "The host stopped while this response streamed.",
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
  const configuration = given.configuration;
  let state = await resumed(context, given);
  let charged = { total: ZERO_USAGE, requests: 0 };
  let callIds = new Map<ModelToolCall, CallId>();
  let reported: AssistantMessage["usage"] | null = null;

  const config: LoopConfig<TurnRequest> = {
    attempt: state.attempt,
    retry: RETRY_POLICY,

    async prepareRequest(asked) {
      const runtime = kernel.pluginsFor(session);
      context.holds.push({ runtime, release: runtime.hold() });

      try {
        await runtime.ready;
        await awaitMcpServers(kernel, runtime, session, signal);
        const configured = modelInfo(models, configuration.model, runtime);

        if (configured === null)
          return failedRequest(`No model ${configuration.model.id} is in the catalog.`);
        const input = { session, head, run: state.run, configuration };

        const body = async () => {
          const built = await requestBody(kernel, models, runtime, input);

          return { ...built, transcript: withReportedUsage(built.transcript, reported) };
        };

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
      execute(call, called) {
        const id = callIds.get(call);

        if (id === undefined)
          throw new SdkError("internal", `Call ${call.id} ran before its response settled.`);

        return executeCall(kernel, {
          runtime: context.holds.at(-1)?.runtime ?? kernel.pluginsFor(session),
          session,
          head,
          run,
          call: id,
          name: call.name,
          args: isJson(call.arguments) ? call.arguments : {},
          argumentsError: call.argumentsError,
          context: CALLER,
          signal: called,
        });
      },
    },

    async settleResponse({ message, calls, usage, prepared }) {
      observe(context, prepared, usage);
      reported = message.usage;
      closeThoughts(state);

      await changeRun(context, run, async (record) => {
        const next = charge(record, usage, true);
        const executing = calls.length > 0 && record.phase !== "executing";
        charged = { total: next.usage ?? usage, requests: next.requests };
        callIds = assignCallIds(run, next.requests, message, calls);

        const intents = record.stopping
          ? []
          : await Promise.all(
              [...callIds].map(async ([call, id]): Promise<RefUpdate> => {
                const intent: ToolIntent = {
                  name: call.name,
                  args: isJson(call.arguments) ? call.arguments : {},
                  principal: CALLER.principal,
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
          record: executing ? { ...next, phase: "executing" } : next,
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

      if (stopping || end.response !== null)
        await failOpen(context, run, stopping ? state.opened : [], ABORTED, end.response);

      return STOPPED;
    }

    case "failed":
      await failOpen(context, run, state.opened, end.failure, end.response);

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
  };

  const live = await attempt(`Opening part ${part}`, async () => {
    const held = await unfenced(kernel.store, session, run);

    if (held === null) return false;

    const outcome = await commit(kernel, [
      held,
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
          },
        ],
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

/** The writes that settle a response's open parts on the head, each in its own commit; a part the stop fence already failed keeps its text. */
async function settledParts(
  context: Turn,
  opened: readonly OpenPart[],
): Promise<readonly RefUpdate[]> {
  const { kernel, session, head } = context;

  if (opened.length === 0) return [];

  const [found, tip] = await Promise.all([
    Promise.all(opened.map(async (entry) => ({ entry, found: await readPart(context, entry) }))),
    readTip(kernel.store, session, head),
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

    const state = buildPartState(entry);
    const version = part.record.version + 1;

    const landed = await settling(kernel.store, {
      session,
      head,
      run: part.record.run,
      parent,
      expect: parent === tip.id ? readRefExpectation(tip.ref) : undefined,
      record: { ...part.record, state, version },
      body: { kind: "part", part: entry.part },
      at,
    });

    updates.push(
      {
        name: partRef(session, entry.part),
        target: landed.target,
        expect: part.ref.revision,
        events: [{ head, kind: "part", part: entry.part, change: "updated", state, version }],
      },
      ...landed.updates,
    );
    parent = landed.landed;
  }

  return updates;
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

function buildPartState(entry: OpenPart): Json {
  if (entry.kind === "text") return { markdown: entry.markdown, signature: entry.textSignature };

  return {
    markdown: entry.markdown,
    merged: entry.merged,
    signature: entry.thoughts.some((thought) => thought.signature !== null || thought.redacted)
      ? entry.thoughts.map((thought) => ({ ...thought }))
      : null,
  };
}

async function readPart(context: Turn, entry: OpenPart): Promise<Found<PartRecord> | null> {
  const { kernel, session } = context;

  return load(
    kernel.store,
    await kernel.store.refs.get(partRef(session, entry.part)),
    decodePartRecord,
  );
}

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
  const state = buildPartState(entry);
  const version = record.version + 1;
  const live = record.status.kind === "live" || record.status.kind === "waiting";
  const status = live ? { kind: "failed", run: record.run, failure } : record.status;
  const target = await put(kernel.store, "part", { ...record, state, version, status });

  return [
    {
      name,
      target,
      expect: found.ref.revision,
      events: [{ head, kind: "part", part, change: "updated", state, version }],
    },
    ...(live
      ? [
          {
            name,
            target,
            events: [{ head, kind: "part", part, change: "failed", failure }],
          } as const,
        ]
      : []),
  ];
}

async function keepOpen(
  context: Turn,
  opened: readonly OpenPart[],
  failure: Failure,
): Promise<readonly RefUpdate[]> {
  const kept = await Promise.all(
    opened.map(async (entry) => {
      const found = await readPart(context, entry);

      return found === null || found.record.status.kind === "settled"
        ? []
        : keep(context, entry, found, failure);
    }),
  );

  return kept.flat();
}

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
      updates: [
        ...(await keepOpen(context, state.opened, failure)),
        ...(await failedParts(kernel.store, session, head, extra, failure)),
      ],
    };
  });

  return retried === null ? state : fresh(retried, 0);
}

async function failOpen(
  context: Turn,
  run: RunId,
  opened: readonly OpenPart[],
  failure: Failure,
  response: FailedResponse<TurnRequest> | null,
): Promise<void> {
  const { kernel, head } = context;

  const updates = () => keepOpen(context, opened, failure);

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
