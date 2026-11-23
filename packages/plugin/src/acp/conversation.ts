import type { PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { ContextOccupancy } from "@nyte-ai/schema";
import type { AgentBehavior } from "./profiles.ts";
import type { Dialect, SubagentReport } from "./codecs/agents.ts";
import { interruptCall, mergeCall, mergeChild } from "./calls.ts";
import type { Call, Child } from "./calls.ts";

export type Entry =
  | { readonly kind: "text" | "thinking"; readonly text: string }
  | { readonly kind: "call"; readonly call: Call };

export type FrameEnd =
  | { readonly kind: "complete"; readonly response: PromptResponse | null }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "cancelled" };

interface FrameLog {
  readonly id: string;
  readonly origin: "prompt" | "detached";
  readonly entries: readonly Entry[];
  readonly calls: ReadonlyMap<string, Call>;
}

export type Frame =
  | { readonly kind: "open"; readonly log: FrameLog }
  | { readonly kind: "sealed"; readonly log: FrameLog; readonly end: FrameEnd };

export type Work =
  | { readonly kind: "idle" }
  | {
      readonly kind: "prompt";
      readonly operation: string;
      readonly frame: Extract<Frame, { kind: "open" }>;
    }
  | { readonly kind: "detached"; readonly frame: Extract<Frame, { kind: "open" }> };

export type GenerationState =
  | { readonly kind: "booting"; readonly generation: string }
  | {
      readonly kind: "serving";
      readonly generation: string;
      readonly work: Work;
      readonly pending: readonly Extract<Frame, { kind: "sealed" }>[];
      readonly children: ReadonlyMap<string, Child>;
      readonly occupancy: ContextOccupancy;
    }
  | { readonly kind: "retired"; readonly generation: string; readonly reason: FrameEnd };

export type ConversationEvent = { readonly generation: string; readonly operation: string } & (
  | { readonly kind: "ready" }
  | { readonly kind: "reserve"; readonly frame: string }
  | {
      readonly kind: "update";
      readonly update: SessionUpdate;
      readonly child?: string;
      readonly detached: string;
    }
  | { readonly kind: "child"; readonly report: SubagentReport }
  | { readonly kind: "response"; readonly response: PromptResponse }
  | { readonly kind: "fail"; readonly message: string }
  | { readonly kind: "stop" }
  | { readonly kind: "consume"; readonly frame: string }
);

export type ConversationEffect =
  | { readonly kind: "changed" }
  | { readonly kind: "offer"; readonly frame: string }
  | { readonly kind: "retire"; readonly end: FrameEnd };

export interface Transition {
  readonly state: GenerationState;
  readonly effects: readonly ConversationEffect[];
}

export function advance(
  state: GenerationState,
  event: ConversationEvent,
  codec: Dialect,
  profile: AgentBehavior,
  cwd: string,
): Transition {
  if (state.generation !== event.generation || state.kind === "retired") {
    return { state, effects: [] };
  }
  if (event.kind === "stop" || event.kind === "fail") {
    const end: FrameEnd =
      event.kind === "stop" ? { kind: "cancelled" } : { kind: "failed", message: event.message };

    return {
      state: { kind: "retired", generation: state.generation, reason: end },
      effects: [{ kind: "retire", end }, { kind: "changed" }],
    };
  }

  if (state.kind === "booting") {
    return event.kind === "ready"
      ? {
          state: {
            kind: "serving",
            generation: state.generation,
            work: { kind: "idle" },
            pending: [],
            children: new Map(),
            occupancy: { kind: "unknown" },
          },
          effects: [{ kind: "changed" }],
        }
      : { state, effects: [] };
  }
  if (event.kind === "consume") {
    return {
      state: { ...state, pending: state.pending.filter((frame) => frame.log.id !== event.frame) },
      effects: [{ kind: "changed" }],
    };
  }
  if (event.kind === "reserve") {
    if (state.work.kind !== "idle") return { state, effects: [] };

    return {
      state: {
        ...state,
        work: {
          kind: "prompt",
          operation: event.operation,
          frame: openFrame(event.frame, "prompt"),
        },
      },
      effects: [{ kind: "changed" }],
    };
  }

  if (event.kind === "response") {
    if (state.work.kind !== "prompt" || state.work.operation !== event.operation) {
      return { state, effects: [] };
    }
    const reason = event.response.stopReason;

    const end: FrameEnd =
      reason === "refusal"
        ? { kind: "failed", message: "The agent refused the request." }
        : reason === "cancelled"
          ? { kind: "failed", message: "The agent cancelled the request without a Nyte Stop." }
          : { kind: "complete", response: event.response };

    return seal(state, end);
  }

  if (event.kind === "child") {
    const children = new Map(state.children);
    children.set(event.report.child, mergeChild(children.get(event.report.child), event.report));

    return { state: { ...state, children }, effects: [{ kind: "changed" }] };
  }

  if (event.kind !== "update") return { state, effects: [] };
  const update = event.update;

  if (event.child !== undefined) return childUpdate(state, event.child, update);

  if (update.sessionUpdate === "subagent_update") {
    const child = update.state;

    const status =
      child?.state === "idle" && "stopReason" in child
        ? child.stopReason === "refusal" || child.stopReason === "error"
          ? "failed"
          : "completed"
        : "running";

    const children = new Map(state.children);

    const report = mergeChild(children.get(update.sessionId), {
      child: update.sessionId,
      title: update.title ?? undefined,
      status,
    });

    children.set(update.sessionId, report);
    const work = state.work;

    if (work.kind === "idle") {
      return { state: { ...state, children }, effects: [{ kind: "changed" }] };
    }
    const native = `child:${update.sessionId}`;
    const log = work.frame.log;
    const previous = log.calls.get(native);

    const call = mergeCall(
      previous,
      {
        toolCallId: native,
        title: report.title,
        ...(status === "completed" || status === "failed"
          ? {
              status: status === "failed" ? ("failed" as const) : ("completed" as const),
              rawOutput: report.text,
            }
          : {}),
      },
      codec,
      cwd,
    );

    const described: Call = { ...call, facts: { ...call.facts, kind: "subagent" } };
    const calls = new Map(log.calls);
    calls.set(native, described);

    return {
      state: {
        ...state,
        children,
        work: {
          ...work,
          frame: {
            kind: "open",
            log: {
              ...log,
              calls,
              entries:
                call.kind === "terminal" && previous?.kind !== "terminal"
                  ? [...log.entries, { kind: "call", call: described }]
                  : log.entries,
            },
          },
        },
      },
      effects: [{ kind: "changed" }],
    };
  }

  if (update.sessionUpdate === "usage_update") {
    const occupancy: ContextOccupancy =
      Number.isFinite(update.used) &&
      update.used >= 0 &&
      Number.isFinite(update.size) &&
      update.size > 0
        ? { kind: "measured", usedTokens: update.used, windowTokens: update.size }
        : { kind: "unknown" };

    const next = { ...state, occupancy };

    return state.work.kind === "detached"
      ? seal(next, { kind: "complete", response: null })
      : { state: next, effects: [{ kind: "changed" }] };
  }

  const material =
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk" ||
    update.sessionUpdate === "tool_call" ||
    update.sessionUpdate === "tool_call_update";

  if (!material) return { state, effects: [] };

  if (state.work.kind === "idle") {
    if (profile.replies === "prompt-only" || update.sessionUpdate === "tool_call_update") {
      return { state, effects: [] };
    }
    const opened = {
      ...state,
      work: { kind: "detached" as const, frame: openFrame(event.detached, "detached") },
    };

    const taken = takeUpdate(opened, update, codec, cwd);

    return {
      state: taken,
      effects: [{ kind: "offer", frame: event.detached }, { kind: "changed" }],
    };
  }

  const next = takeUpdate(state, update, codec, cwd);
  const bytes = JSON.stringify(next.work).length;

  if (bytes > 4 * 1024 * 1024 || next.pending.length > 32) {
    return {
      state: {
        kind: "retired",
        generation: state.generation,
        reason: { kind: "failed", message: "The agent exceeded the unread reply limit." },
      },
      effects: [
        {
          kind: "retire",
          end: { kind: "failed", message: "The agent exceeded the unread reply limit." },
        },
        { kind: "changed" },
      ],
    };
  }
  return { state: next, effects: [{ kind: "changed" }] };
}

function openFrame(id: string, origin: "prompt" | "detached"): Extract<Frame, { kind: "open" }> {
  return { kind: "open", log: { id, origin, entries: [], calls: new Map() } };
}

function seal(state: Extract<GenerationState, { kind: "serving" }>, end: FrameEnd): Transition {
  if (state.work.kind === "idle") return { state, effects: [] };
  const log = state.work.frame.log;

  const missing = [...log.calls.values()]
    .filter((call) => call.kind !== "terminal")
    .map(interruptCall);

  const calls = new Map([
    ...log.calls,
    ...missing.map((call) => [call.facts.native, call] as const),
  ]);

  const frame: Extract<Frame, { kind: "sealed" }> = {
    kind: "sealed",
    log: {
      ...log,
      calls,
      entries: [...log.entries, ...missing.map((call) => ({ kind: "call" as const, call }))],
    },
    end,
  };

  return {
    state: { ...state, work: { kind: "idle" }, pending: [...state.pending, frame] },
    effects: [{ kind: "changed" }],
  };
}

function takeUpdate(
  state: Extract<GenerationState, { kind: "serving" }>,
  update: SessionUpdate,
  codec: Dialect,
  cwd: string,
): Extract<GenerationState, { kind: "serving" }> {
  const work = state.work;

  if (work.kind === "idle") return state;
  const log = work.frame.log;

  if (
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk"
  ) {
    if (update.content.type !== "text") return state;

    const entry: Entry = {
      kind: update.sessionUpdate === "agent_message_chunk" ? "text" : "thinking",
      text: update.content.text,
    };

    return {
      ...state,
      work: { ...work, frame: { kind: "open", log: { ...log, entries: [...log.entries, entry] } } },
    };
  }

  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return state;
  }
  const previous = log.calls.get(update.toolCallId);
  const call = mergeCall(previous, update, codec, cwd);

  if (call === previous) return state;
  const calls = new Map(log.calls);
  calls.set(update.toolCallId, call);

  return {
    ...state,
    work: {
      ...work,
      frame: {
        kind: "open",
        log: {
          ...log,
          calls,
          entries:
            call.kind === "terminal" ? [...log.entries, { kind: "call", call }] : log.entries,
        },
      },
    },
  };
}

function childUpdate(
  state: Extract<GenerationState, { kind: "serving" }>,
  child: string,
  update: SessionUpdate,
): Transition {
  const previous = state.children.get(child);

  if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") {
    return { state, effects: [] };
  }
  const children = new Map(state.children);
  children.set(child, {
    id: child,
    title: previous?.title ?? "Subagent",
    state: previous?.state ?? "running",
    text: (previous?.text ?? "") + update.content.text,
  });

  return { state: { ...state, children }, effects: [{ kind: "changed" }] };
}
