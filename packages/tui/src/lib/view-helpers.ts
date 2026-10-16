import { isPart, text, thinking, tool } from "@nyte-ai/plugin/client";
import type { PartState } from "@nyte-ai/plugin/client";
import type {
  Message,
  MessageSource,
  PartStatus,
  SessionView,
  ToolPartState,
  Usage,
  UserContent,
} from "@nyte-ai/sdk";

export type UserMessage = Extract<Message, { readonly kind: "user" }>;

export type ReportMessage = UserMessage & {
  readonly source: Extract<MessageSource, { readonly kind: "child" | "job" }>;
};

export function isReport(message: UserMessage): message is ReportMessage {
  return message.source.kind === "child" || message.source.kind === "job";
}

export function shownContent(message: UserMessage): UserContent {
  return message.source.kind === "action" ? message.source.label : message.content;
}

export type PartMessage = Extract<Message, { readonly kind: "part" }>;

export type ToolMessage = PartMessage & { readonly state: ToolPartState };

export function isToolMessage(message: Message): message is ToolMessage {
  return isPart(message, tool);
}

function isLanding(message: UserMessage, view: SessionView): boolean {
  if (view.execution.kind !== "idle") return false;

  return (
    message.status.kind === "pending" ||
    (message.status.kind === "unsent" && message.status.retrying === null)
  );
}

export function queuedMessages(view: SessionView): readonly UserMessage[] {
  return view.messages.flatMap((message) =>
    message.kind === "user" &&
    message.status.kind !== "landed" &&
    !isReport(message) &&
    !isLanding(message, view)
      ? [message]
      : [],
  );
}

export function landingMessages(view: SessionView): readonly UserMessage[] {
  return view.messages.flatMap((message) =>
    message.kind === "user" &&
    message.status.kind !== "landed" &&
    !isReport(message) &&
    isLanding(message, view)
      ? [message]
      : [],
  );
}

export function pendingReports(view: SessionView): readonly ReportMessage[] {
  return view.messages.flatMap((message) =>
    message.kind === "user" && message.status.kind !== "landed" && isReport(message)
      ? [message]
      : [],
  );
}

export function sessionUsage(view: SessionView): Usage {
  const empty: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: null,
    total: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  return view.turns.reduce((sum, turn) => {
    if (turn.state.kind !== "ended" || turn.state.end.kind !== "completed") return sum;
    const usage = turn.state.end.usage;

    return {
      input: sum.input + usage.input,
      output: sum.output + usage.output,
      cacheRead: sum.cacheRead + usage.cacheRead,
      cacheWrite: sum.cacheWrite + usage.cacheWrite,
      reasoning: usage.reasoning === null ? sum.reasoning : (sum.reasoning ?? 0) + usage.reasoning,
      total: sum.total + usage.total,
      cost: {
        input: sum.cost.input + usage.cost.input,
        output: sum.cost.output + usage.cost.output,
        cacheRead: sum.cost.cacheRead + usage.cost.cacheRead,
        cacheWrite: sum.cost.cacheWrite + usage.cost.cacheWrite,
        total: sum.cost.total + usage.cost.total,
      },
    };
  }, empty);
}

export type ToolTense = "running" | "past" | "none";

export type ToolTone = "running" | "attention" | "success" | "failure" | "stopped";

export interface ToolStatus {
  readonly tense: ToolTense;
  readonly tone: ToolTone;
  readonly word: string | undefined;
}

const RUNNING: ToolStatus = { tense: "running", tone: "running", word: undefined };

export function toolStatus(state: ToolPartState, status: PartStatus): ToolStatus {
  if (status.kind === "failed")
    return status.failure.class === "aborted"
      ? { tense: "none", tone: "stopped", word: "Stopped" }
      : { tense: "none", tone: "failure", word: "Failed" };

  if (status.kind === "waiting")
    return status.on.kind === "part"
      ? { tense: "running", tone: "attention", word: "Needs input" }
      : RUNNING;

  if (state.phase !== "settled") return RUNNING;

  switch (state.outcome.kind) {
    case "ok":
      return { tense: "past", tone: "success", word: undefined };
    case "failed":
      return { tense: "none", tone: "failure", word: "Failed" };
    case "rejected":
      return { tense: "none", tone: "failure", word: "Blocked" };
    case "stopped":
      return { tense: "none", tone: "stopped", word: "Stopped" };
    case "interrupted":
      return { tense: "none", tone: "stopped", word: "Interrupted" };
    default: {
      const _exhaustive: never = state.outcome;

      return _exhaustive;
    }
  }
}

export function toolOutput(state: ToolPartState): string {
  if (state.phase !== "settled") return "";

  switch (state.outcome.kind) {
    case "ok":
      return state.outcome.content
        .flatMap((item) => (item.kind === "text" ? [item.text] : []))
        .join("\n");
    case "failed":
      return state.outcome.message;
    case "rejected":
      return state.outcome.reason;
    case "stopped":
    case "interrupted":
      return "";
    default: {
      const _exhaustive: never = state.outcome;

      return _exhaustive;
    }
  }
}

export interface CompletionTrigger {
  readonly kind: "@" | "/";
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export function completionTrigger(
  value: string,
  cursor = value.length,
): CompletionTrigger | undefined {
  const caret = Math.max(0, Math.min(cursor, value.length));
  let start = caret;

  while (start > 0 && (value[start - 1] ?? "").trim() !== "") start -= 1;
  const kind = value[start];

  if (start === caret || (kind !== "@" && kind !== "/")) return undefined;
  let end = caret;

  while (end < value.length && (value[end] ?? "").trim() !== "") end += 1;

  return { kind, start, end, query: value.slice(start + 1, caret) };
}

export function follow<T>(
  stream: AsyncIterable<T>,
  next: (value: T) => void,
  fail: (cause: unknown) => void,
): () => void {
  const iterator = stream[Symbol.asyncIterator]();
  let open = true;

  void (async () => {
    try {
      for (;;) {
        const step = await iterator.next();

        if (step.done === true || !open) return;
        next(step.value);
      }
    } catch (cause) {
      if (open) fail(cause);
    }
  })();

  return () => {
    if (!open) return;
    open = false;
    void iterator.return?.();
  };
}

export function isTextMessage(
  message: Message,
): message is PartMessage & { readonly state: PartState<typeof text> } {
  return isPart(message, text);
}

export function isThinkingMessage(
  message: Message,
): message is PartMessage & { readonly state: PartState<typeof thinking> } {
  return isPart(message, thinking);
}
