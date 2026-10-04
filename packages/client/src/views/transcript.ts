import type { Turn, TurnPart, TurnToolClass, UserTurnPart } from "@nyte-ai/protocol";
import type {
  Commit,
  CommitBody,
  MessageSource,
  Oid,
  ParkedCall,
  RunInfo,
  ToolClass,
  ToolState,
} from "@nyte-ai/protocol";

type MessageBody = Extract<CommitBody, { kind: "message" }>;

type UserMessage = Extract<MessageBody["message"], { role: "user" }>;

type AssistantMessage = Extract<MessageBody["message"], { role: "assistant" }>;

type ToolResultMessage = Extract<MessageBody["message"], { role: "toolResult" }>;

type AssistantCommit = Extract<Commit, { readonly calls: Readonly<Record<string, ToolClass>> }>;

type ToolResultCommit = Extract<Commit, { readonly call: ToolClass }>;

/** The turn shapes are wire types: a snapshot carries them. Declared in `@nyte-ai/protocol`. */
export type { ToolTurnPart, Turn, TurnPart, UserTurnPart } from "@nyte-ai/protocol";

type ConversationTurn = Extract<Turn, { kind: "turn" }>;

type CommitItem = { readonly oid: Oid; readonly commit: Commit };

/** What a call without a result commit is read against: the head's run and the asks parked on it. */
export interface RunEvidence {
  readonly run: Pick<RunInfo, "phase"> | undefined;
  readonly parked: readonly Pick<ParkedCall, "callId" | "waitId" | "selection">[];
}

export const NO_RUN: RunEvidence = { run: undefined, parked: [] };

const INTERRUPTED: ToolState = { kind: "error", reason: { kind: "interrupted" }, commit: null };

type OpenToolState = Extract<ToolState, { readonly kind: "pending" | "running" }>;

function isOpen(state: ToolState): state is OpenToolState {
  return state.kind === "pending" || state.kind === "running";
}

/** A state the projection wrote from run evidence, not from a commit: every stored result names its commit. */
function isSynthetic(state: ToolState): boolean {
  return isOpen(state) || state.commit === null;
}

/** The state of a call in the newest turn that has no result commit. */
function openToolState(callId: string, evidence: RunEvidence): ToolState {
  const { run } = evidence;

  if (run === undefined) return INTERRUPTED;

  switch (run.phase.kind) {
    case "respond":
    case "retry":
      return { kind: "pending" };
    case "tools":
      return { kind: "running" };
    case "waiting": {
      const ask = evidence.parked.find(
        (call) => call.callId === callId && call.selection !== undefined,
      );

      return ask === undefined
        ? { kind: "running" }
        : { kind: "running", waitingFor: { kind: "input", waitId: ask.waitId } };
    }

    case "done":
    case "aborted":
    case "failed":
      return INTERRUPTED;
    default: {
      const _exhaustive: never = run.phase;

      return _exhaustive;
    }
  }
}

/**
 * The state a result commit settles a call into: the settlement core stored, or
 * the one a record from before settlements were stored implies through `isError`.
 */
function settledToolState(item: CommitItem & { readonly commit: ToolResultCommit }): ToolState {
  const { settlement } = item.commit;

  if (settlement !== undefined) return { ...settlement, commit: item.oid };

  return item.commit.body.message.isError
    ? { kind: "error", reason: { kind: "error" }, commit: item.oid }
    : { kind: "success", commit: item.oid };
}

function sameSyntheticState(state: ToolState, next: ToolState): boolean {
  switch (next.kind) {
    case "pending":
    case "success":
      return state.kind === next.kind;
    case "running":
      return state.kind === "running" && state.waitingFor?.waitId === next.waitingFor?.waitId;
    case "error":
      return state.kind === "error" && state.reason.kind === next.reason.kind;
    default: {
      const _exhaustive: never = next;

      return _exhaustive;
    }
  }
}

/** Re-read the newest turn's synthetic states against the run; nothing else can change without a commit. */
export function transcriptWithRun(state: TranscriptState, evidence: RunEvidence): TranscriptState {
  const last = state.items.at(-1);

  if (last?.kind !== "turn") return state;
  let changed = false;

  const parts = last.parts.map((part): TurnPart => {
    if (part.kind !== "tool" || !isSynthetic(part.state)) return part;
    const next = openToolState(part.callId, evidence);

    if (sameSyntheticState(part.state, next)) return part;
    changed = true;

    return { ...part, state: next };
  });

  if (!changed) return state;

  return { items: [...state.items.slice(0, -1), { ...last, parts }], tip: state.tip };
}

/** A turn the conversation moved past can no longer settle its calls. */
function abandonOpenCalls(builder: TranscriptBuilder): void {
  const last = builder.items.at(-1);

  if (
    last?.kind !== "turn" ||
    !last.parts.some((part) => part.kind === "tool" && isOpen(part.state))
  )
    return;

  builder.items[builder.items.length - 1] = {
    ...last,
    parts: last.parts.map((part) =>
      part.kind === "tool" && isOpen(part.state) ? { ...part, state: INTERRUPTED } : part,
    ),
  };
}

interface TranscriptBuilder {
  readonly items: Turn[];
  readonly evidence: RunEvidence;
  readonly sharedTail?: Turn;
  readonly toolCalls?: Map<string, number>;
}

/** Stable semantic identity for one part, independent of any renderer. */
export function turnPartId(part: TurnPart): string {
  switch (part.kind) {
    case "user":
      return `user:${part.commit}`;
    case "assistant":
    case "thinking":
      return `${part.kind}:${part.commit}:${String(part.contentIndex)}`;
    case "tool":
      return `tool:${part.callId}`;
    default: {
      const _exhaustive: never = part;

      return _exhaustive;
    }
  }
}

/** Incremental transcript state for one branch tip. */
export interface TranscriptState {
  readonly items: readonly Turn[];
  readonly tip: Oid | null;
}

export const EMPTY_TRANSCRIPT: TranscriptState = { items: [], tip: null };

/** An await on children is the run's own control flow; the children's cards show how each is doing. */
function drawnToolClass(toolClass: ToolClass): TurnToolClass | undefined {
  return toolClass.kind === "delegate" && toolClass.role === "await" ? undefined : toolClass;
}

function toolResultText(message: ToolResultMessage): string {
  return message.content
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "image":
          return "[image]";
        default: {
          const _exhaustive: never = part;

          return _exhaustive;
        }
      }
    })
    .join("");
}

/**
 * Whitespace is not content: providers pad text and thinking blocks around
 * tool calls, and a part that draws nothing should not reach a client as one.
 */
function assistantParts(
  item: CommitItem & { readonly commit: AssistantCommit },
  message: AssistantMessage,
  evidence: RunEvidence,
): TurnPart[] {
  const parts: TurnPart[] = [];

  for (const [contentIndex, part] of message.content.entries()) {
    switch (part.type) {
      case "text":
        if (part.text.trim() !== "") {
          parts.push({
            kind: "assistant",
            commit: item.oid,
            contentIndex,
            text: part.text,
            at: item.commit.at,
          });
        }

        break;
      case "thinking":
        if (part.thinking.trim() !== "") {
          parts.push({
            kind: "thinking",
            commit: item.oid,
            contentIndex,
            text: part.thinking,
            at: item.commit.at,
          });
        }

        break;
      case "toolCall": {
        const toolClass = item.commit.calls[part.id];

        if (toolClass === undefined)
          throw new Error(`Assistant commit has no class for ${part.id}`);
        const drawn = drawnToolClass(toolClass);

        if (drawn !== undefined) {
          parts.push({
            kind: "tool",
            callId: part.id,
            class: drawn,
            state: openToolState(part.id, evidence),
            at: item.commit.at,
          });
        }

        break;
      }

      default: {
        const _exhaustive: never = part;

        return _exhaustive;
      }
    }
  }

  return parts;
}

/**
 * Full projection owns its turns; incremental append copies the shared tail
 * only when writing to it. A host clock can step backwards mid-turn, so the
 * span only ever grows.
 */
function landingTurn(builder: TranscriptBuilder, item: CommitItem): ConversationTurn {
  const last = builder.items.at(-1);

  if (last?.kind === "turn") {
    const turn = last === builder.sharedTail ? { ...last, parts: [...last.parts] } : last;
    turn.durationMs = Math.max(turn.durationMs, item.commit.at - turn.startedAt);

    if (turn.run.kind === "none" && item.commit.run !== undefined) {
      turn.run = { kind: "run", id: item.commit.run };
    }

    builder.items[builder.items.length - 1] = turn;

    return turn;
  }

  const turn: ConversationTurn = {
    kind: "turn",
    id: item.oid,
    run: item.commit.run === undefined ? { kind: "none" } : { kind: "run", id: item.commit.run },
    parts: [],
    startedAt: item.commit.at,
    durationMs: 0,
  };

  builder.toolCalls?.clear();
  builder.items.push(turn);

  return turn;
}

/** A request opens a turn whatever the commits before it were doing. */
function appendUser(
  items: Turn[],
  item: CommitItem,
  message: UserMessage,
  source: MessageSource | undefined,
): void {
  const part: UserTurnPart = {
    kind: "user",
    commit: item.oid,
    parent: item.commit.parent,
    content: message.content,
    at: item.commit.at,
  };

  const sourced = source === undefined ? part : { ...part, source };
  const keyed = item.commit.key === undefined ? sourced : { ...sourced, key: item.commit.key };
  items.push({
    kind: "turn",
    id: item.oid,
    run: item.commit.run === undefined ? { kind: "none" } : { kind: "run", id: item.commit.run },
    startedAt: item.commit.at,
    durationMs: 0,
    parts: [keyed],
  });
}

function appendAssistant(
  builder: TranscriptBuilder,
  item: CommitItem & { readonly commit: AssistantCommit },
  message: AssistantMessage,
): void {
  const failure = item.commit.outcome.kind === "failed" ? item.commit.outcome.failure : undefined;
  const parts = assistantParts(item, message, builder.evidence);

  if (parts.length === 0 && failure === undefined) return;
  const turn = landingTurn(builder, item);

  if (failure === undefined) delete turn.failure;
  else turn.failure = failure;

  for (const part of parts) {
    if (part.kind === "tool" && !builder.toolCalls?.has(part.callId)) {
      builder.toolCalls?.set(part.callId, turn.parts.length);
    }

    turn.parts.push(part);
  }
}

/** A result settles the call it answers, or stands alone when the call is not on this branch. */
function appendToolResult(
  builder: TranscriptBuilder,
  item: CommitItem & { readonly commit: ToolResultCommit },
  message: ToolResultMessage,
): void {
  const settled = drawnToolClass(item.commit.call);

  if (settled === undefined) return;
  const turn = landingTurn(builder, item);
  const state = settledToolState(item);
  const output = toolResultText(message);
  const settlement = output === "" ? { state } : { state, output };

  const index =
    builder.toolCalls === undefined
      ? turn.parts.findIndex((part) => part.kind === "tool" && part.callId === message.toolCallId)
      : (builder.toolCalls.get(message.toolCallId) ?? -1);

  const call = turn.parts[index];

  if (call?.kind === "tool") {
    turn.parts[index] = { ...call, class: settled, ...settlement, at: item.commit.at };

    return;
  }

  builder.toolCalls?.set(message.toolCallId, turn.parts.length);
  turn.parts.push({
    kind: "tool",
    callId: message.toolCallId,
    class: settled,
    ...settlement,
    at: item.commit.at,
  });
}

/**
 * Fold one commit into the transcript. A live client appends as commits land,
 * a restore folds the branch, and both arrive at the same items. A checkpoint
 * is appended like any other marker; it cuts model context, never the turns
 * before it. Repeating the tip is a no-op. A different parent asks the caller
 * to refold the branch.
 */
export function appendTranscriptCommit(
  state: TranscriptState,
  item: { readonly oid: Oid; readonly commit: Commit },
  evidence: RunEvidence = NO_RUN,
): TranscriptState | undefined {
  if (item.oid === state.tip) return state;

  if (item.commit.parent !== state.tip) return undefined;

  const items = [...state.items];
  appendTranscriptItem({ items, evidence, sharedTail: state.items.at(-1) }, item);

  return { items, tip: item.oid };
}

/** Mutate only the builder's owned items, copying a shared turn at its first write. */
function appendTranscriptItem(builder: TranscriptBuilder, item: CommitItem): void {
  const items = builder.items;
  const { body } = item.commit;

  switch (body.kind) {
    case "message": {
      switch (body.message.role) {
        case "assistant":
          if (!("calls" in item.commit)) throw new Error("Assistant commit has no call classes");
          appendAssistant(builder, { ...item, commit: item.commit }, body.message);
          break;
        case "toolResult":
          if (!("call" in item.commit)) throw new Error("Tool result commit has no call class");
          appendToolResult(builder, { ...item, commit: item.commit }, body.message);
          break;
        case "user":
          builder.toolCalls?.clear();
          abandonOpenCalls(builder);
          appendUser(items, item, body.message, "source" in body ? body.source : undefined);
          break;
        case "system":
          break;
        default: {
          const _exhaustive: never = body.message;

          return _exhaustive;
        }
      }

      break;
    }

    case "completion":
      builder.toolCalls?.clear();
      abandonOpenCalls(builder);
      // A background result answers the model, not the user. It opens its own
      // turn, with nothing to draw, so the response it triggers does not graft
      // onto an earlier request's turn or stretch that turn's duration.
      items.push({
        kind: "turn",
        id: item.oid,
        run:
          item.commit.run === undefined ? { kind: "none" } : { kind: "run", id: item.commit.run },
        startedAt: item.commit.at,
        durationMs: 0,
        parts: [],
      });
      break;
    case "checkpoint":
      abandonOpenCalls(builder);
      items.push({ kind: "checkpoint", commit: item.oid, at: item.commit.at, body });
      break;
    case "summary":
      abandonOpenCalls(builder);
      items.push({ kind: "summary", commit: item.oid, at: item.commit.at, body });
      break;
    case "config":
      abandonOpenCalls(builder);
      items.push({ kind: "config", commit: item.oid, at: item.commit.at, body });
      break;
    case "usage":
      break;
    default: {
      const _exhaustive: never = body;

      return _exhaustive;
    }
  }
}

/** Project one branch, oldest first, into the conversation items a client renders. */
export function transcriptFromCommits(
  commits: readonly { readonly oid: Oid; readonly commit: Commit }[],
  evidence: RunEvidence = NO_RUN,
): Turn[] {
  const builder: TranscriptBuilder = { items: [], evidence, toolCalls: new Map() };
  let tip: Oid | null = null;

  for (const item of commits) {
    if (item.oid === tip) continue;

    if (item.commit.parent !== tip) {
      throw new Error("Commits do not form an oldest-first branch");
    }

    appendTranscriptItem(builder, item);
    tip = item.oid;
  }

  return builder.items;
}
