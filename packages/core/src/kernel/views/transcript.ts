import { toJsonValue } from "../json.ts";
import type { Turn, TurnOutcome, TurnPart } from "@nyte-ai/protocol";
import type { Commit, CommitBody, Oid } from "../model.ts";

type MessageBody = Extract<CommitBody, { kind: "message" }>;
type UserMessage = Extract<MessageBody["message"], { role: "user" }>;
type AssistantMessage = Extract<MessageBody["message"], { role: "assistant" }>;
type ToolResultMessage = Extract<MessageBody["message"], { role: "toolResult" }>;

/** The turn shapes are wire types: a snapshot carries them. Declared in `@nyte-ai/protocol`. */
export type { ToolTurnPart, Turn, TurnOutcome, TurnPart, UserTurnPart } from "@nyte-ai/protocol";

type ConversationTurn = Extract<Turn, { kind: "turn" }>;
type CommitItem = { readonly oid: Oid; readonly commit: Commit };

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
    case "note":
      return `note:${part.commit}`;
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

function outcomeFrom(message: AssistantMessage): TurnOutcome {
  if (message.stopReason === "aborted") return "aborted";
  if (message.stopReason === "error" || message.errorMessage !== undefined) return "failed";
  return "completed";
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
 * The turn this commit lands in: a fresh copy of the open tail, replaced in
 * `items`, or a new turn pushed onto it. `items` is the caller's own copy, so
 * writing into it here keeps the fold pure from the outside. Every commit that
 * lands in a turn also dates it, and a host clock can step backwards mid-turn,
 * so the span only ever grows.
 */
function landingTurn(items: Turn[], item: CommitItem): ConversationTurn {
  const last = items.at(-1);
  const turn: ConversationTurn =
    last?.kind === "turn"
      ? {
          ...last,
          parts: [...last.parts],
          durationMs: Math.max(last.durationMs, item.commit.at - last.startedAt),
        }
      : {
          kind: "turn",
          id: item.oid,
          parts: [],
          outcome: "completed",
          startedAt: item.commit.at,
          durationMs: 0,
        };
  items[last?.kind === "turn" ? items.length - 1 : items.length] = turn;
  return turn;
}

/** A request opens a turn whatever the commits before it were doing. */
function appendUser(items: Turn[], item: CommitItem, message: UserMessage): void {
  items.push({
    kind: "turn",
    id: item.oid,
    outcome: "completed",
    startedAt: item.commit.at,
    durationMs: 0,
    parts: [
      { kind: "user", commit: item.oid, parent: item.commit.parent, content: message.content },
    ],
  });
}

function appendAssistant(items: Turn[], item: CommitItem, message: AssistantMessage): void {
  const outcome = outcomeFrom(message);
  if (!hasVisibleAssistantContent(message) && outcome === "completed") return;
  const turn = landingTurn(items, item);
  turn.outcome = outcome;
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
          toolName: part.name,
          args: toJsonValue(part.arguments),
        });
        break;
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }
  if (message.stopReason !== "aborted" && message.errorMessage !== undefined) {
    turn.parts.push({ kind: "note", commit: item.oid, text: `Error: ${message.errorMessage}` });
  }
}

/** A result settles the call it answers, or stands alone when the call is not on this branch. */
function appendToolResult(items: Turn[], item: CommitItem, message: ToolResultMessage): void {
  const turn = landingTurn(items, item);
  const result = {
    commit: item.oid,
    output: toolResultText(message),
    isError: message.isError,
  };
  const withDetails =
    message.details === undefined ? result : { ...result, details: toJsonValue(message.details) };
  const completeResult =
    message.title === undefined ? withDetails : { ...withDetails, title: message.title };
  const index = turn.parts.findIndex(
    (part) => part.kind === "tool" && part.callId === message.toolCallId,
  );
  const call = turn.parts[index];
  if (call?.kind === "tool") {
    turn.parts[index] = { ...call, result: completeResult };
    return;
  }
  turn.parts.push({
    kind: "tool",
    callId: message.toolCallId,
    toolName: message.toolName,
    result: completeResult,
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
  const { body } = item.commit;
  switch (body.kind) {
    case "message": {
      const { message } = body;
      switch (message.role) {
        case "user":
          appendUser(items, item, message);
          break;
        case "assistant":
          appendAssistant(items, item, message);
          break;
        case "toolResult":
          appendToolResult(items, item, message);
          break;
        default: {
          const _exhaustive: never = message;
          return _exhaustive;
        }
      }
      break;
    }
    case "checkpoint":
      items.push({ kind: "checkpoint", commit: item.oid, at: item.commit.at, body });
      break;
    case "summary":
      items.push({ kind: "summary", commit: item.oid, at: item.commit.at, body });
      break;
    case "config":
      items.push({ kind: "config", commit: item.oid, at: item.commit.at, body });
      break;
    case "note":
      items.push({ kind: "note", commit: item.oid, at: item.commit.at, body });
      break;
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
  return { items, tip: item.oid };
}

/** Project one branch, oldest first, into the conversation items a client renders. */
export function transcriptFromCommits(
  commits: readonly { readonly oid: Oid; readonly commit: Commit }[],
): Turn[] {
  let state = EMPTY_TRANSCRIPT;
  for (const item of commits) {
    const next = appendTranscriptCommit(state, item);
    if (next === undefined) throw new Error("Commits do not form an oldest-first branch");
    state = next;
  }
  return [...state.items];
}
