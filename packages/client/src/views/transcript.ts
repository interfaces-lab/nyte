import type { ToolTurnPart, Turn, TurnPart, UserTurnPart } from "@nyte-ai/protocol";
import type { Commit, CommitBody, Oid } from "@nyte-ai/protocol";

type MessageBody = Extract<CommitBody, { kind: "message" }>;
type UserMessage = Extract<MessageBody["message"], { role: "user" }>;
type AssistantMessage = Extract<MessageBody["message"], { role: "assistant" }>;
type ToolResultMessage = Extract<MessageBody["message"], { role: "toolResult" }>;

/** The turn shapes are wire types: a snapshot carries them. Declared in `@nyte-ai/protocol`. */
export type { ToolTurnPart, Turn, TurnPart, UserTurnPart } from "@nyte-ai/protocol";

type ConversationTurn = Extract<Turn, { kind: "turn" }>;
type CommitItem = { readonly oid: Oid; readonly commit: Commit };

interface TranscriptBuilder {
  readonly items: Turn[];
  readonly sharedTail?: Turn;
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
function hasVisibleAssistantContent(message: AssistantMessage): boolean {
  return message.content.some((part) => {
    switch (part.type) {
      case "toolCall":
        return true;
      case "text":
        return part.text.trim() !== "";
      case "thinking":
        return part.thinking.trim() !== "";
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  });
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
    builder.items[builder.items.length - 1] = turn;
    return turn;
  }
  const turn: ConversationTurn = {
    kind: "turn",
    id: item.oid,
    parts: [],
    startedAt: item.commit.at,
    durationMs: 0,
  };
  builder.items.push(turn);
  return turn;
}

/** A request opens a turn whatever the commits before it were doing. */
function appendUser(items: Turn[], item: CommitItem, message: UserMessage): void {
  const part: UserTurnPart = {
    kind: "user",
    commit: item.oid,
    parent: item.commit.parent,
    content: message.content,
  };
  items.push({
    kind: "turn",
    id: item.oid,
    startedAt: item.commit.at,
    durationMs: 0,
    parts: [item.commit.key === undefined ? part : { ...part, key: item.commit.key }],
  });
}

function appendAssistant(
  builder: TranscriptBuilder,
  item: CommitItem,
  message: AssistantMessage,
): void {
  const { failure } = item.commit;
  if (!hasVisibleAssistantContent(message) && failure === undefined) return;
  const turn = landingTurn(builder, item);
  if (failure !== undefined) turn.failure = failure;
  for (const [contentIndex, part] of message.content.entries()) {
    switch (part.type) {
      case "text":
        if (part.text.trim() !== "") {
          turn.parts.push({ kind: "assistant", commit: item.oid, contentIndex, text: part.text });
        }
        break;
      case "thinking":
        if (part.thinking.trim() !== "") {
          turn.parts.push({
            kind: "thinking",
            commit: item.oid,
            contentIndex,
            text: part.thinking,
          });
        }
        break;
      case "toolCall":
        turn.parts.push({
          kind: "tool",
          callId: part.id,
          class: item.commit.calls?.[part.id] ?? { kind: "custom", label: part.name },
        });
        break;
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }
}

/** A result settles the call it answers, or stands alone when the call is not on this branch. */
function appendToolResult(
  builder: TranscriptBuilder,
  item: CommitItem,
  message: ToolResultMessage,
): void {
  const turn = landingTurn(builder, item);
  const result: ToolTurnPart["result"] = {
    commit: item.oid,
    output: toolResultText(message),
    isError: message.isError,
  };
  const settled = item.commit.calls?.[message.toolCallId];
  const index = turn.parts.findIndex(
    (part) => part.kind === "tool" && part.callId === message.toolCallId,
  );
  const call = turn.parts[index];
  if (call?.kind === "tool") {
    turn.parts[index] = { ...call, class: settled ?? call.class, result };
    return;
  }
  turn.parts.push({
    kind: "tool",
    callId: message.toolCallId,
    class: settled ?? { kind: "custom", label: message.toolName },
    result,
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
): TranscriptState | undefined {
  if (item.oid === state.tip) return state;
  if (item.commit.parent !== state.tip) return undefined;

  const items = [...state.items];
  appendTranscriptItem({ items, sharedTail: state.items.at(-1) }, item);
  return { items, tip: item.oid };
}

/** Mutate only the builder's owned items, copying a shared turn at its first write. */
function appendTranscriptItem(builder: TranscriptBuilder, item: CommitItem): void {
  const items = builder.items;
  const { body } = item.commit;
  switch (body.kind) {
    case "message": {
      const { message } = body;
      switch (message.role) {
        case "user":
          appendUser(items, item, message);
          break;
        case "assistant":
          appendAssistant(builder, item, message);
          break;
        case "toolResult":
          appendToolResult(builder, item, message);
          break;
        default: {
          const _exhaustive: never = message;
          return _exhaustive;
        }
      }
      break;
    }
    case "completion":
      // A background result answers the model, not the user. It opens its own
      // turn, with nothing to draw, so the response it triggers does not graft
      // onto an earlier request's turn or stretch that turn's duration.
      items.push({
        kind: "turn",
        id: item.oid,
        startedAt: item.commit.at,
        durationMs: 0,
        parts: [],
      });
      break;
    case "checkpoint":
      items.push({ kind: "checkpoint", commit: item.oid, at: item.commit.at, body });
      break;
    case "summary":
      items.push({ kind: "summary", commit: item.oid, at: item.commit.at, body });
      break;
    case "config":
      items.push({ kind: "config", commit: item.oid, at: item.commit.at, body });
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
): Turn[] {
  const builder: TranscriptBuilder = { items: [] };
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
