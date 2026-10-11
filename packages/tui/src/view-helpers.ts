/**
 * Facts the terminal draws that `SessionView` does not carry, written over the
 * view: the turn buckets, the queue, open questions, a tool call's status word,
 * the session's spend so far, and the composer's completion token.
 */
import { isPart, text, thinking, tool } from "@nyte-ai/plugin/client";
import type { PartState } from "@nyte-ai/plugin/client";
import { question } from "@nyte-ai/plugin/question";
import type {
  Message,
  PartId,
  PartStatus,
  SessionView,
  ToolPartState,
  TurnInfo,
  Usage,
} from "@nyte-ai/sdk";

/** A user input as the view carries it. */
export type UserMessage = Extract<Message, { readonly kind: "user" }>;

/** A part as the view carries it in the transcript. */
export type PartMessage = Extract<Message, { readonly kind: "part" }>;

/** A tool part, its state narrowed to `ToolPartState`. */
export type ToolMessage = PartMessage & { readonly state: ToolPartState };

/** One turn with the messages the fold put in it, in conversation order. */
export interface TurnEntry {
  readonly turn: TurnInfo;
  readonly messages: readonly Message[];
}

/** Returns true when a part message is a tool call. */
export function isToolMessage(message: Message): message is ToolMessage {
  return isPart(message, tool);
}

/**
 * Buckets the transcript by turn in one pass, the view's own turn order. User
 * messages still unsent or pending are the queue's, not the transcript's.
 */
export function turnEntries(view: SessionView): readonly TurnEntry[] {
  const byTurn = new Map<string, Message[]>();

  for (const message of view.messages) {
    if (message.kind === "user" && message.status.kind !== "landed") continue;
    const bucket = byTurn.get(message.turn) ?? [];
    bucket.push(message);
    byTurn.set(message.turn, bucket);
  }

  return view.turns.map((turn) => ({ turn, messages: byTurn.get(turn.id) ?? [] }));
}

/** Returns the messages not yet placed: this client's unsent sends, then the host's pending inputs. */
export function queuedMessages(view: SessionView): readonly UserMessage[] {
  return view.messages.flatMap((message) =>
    message.kind === "user" && message.status.kind !== "landed" ? [message] : [],
  );
}

/** One question a modal part asks, with the part that answers it. */
export interface OpenQuestion {
  readonly part: PartId;
  readonly prompt: string;
  readonly options: readonly string[];
}

/** Returns the `ask/question` parts still open on this head, oldest first. */
export function openQuestions(view: SessionView): readonly OpenQuestion[] {
  return view.parts.flatMap((part) => {
    if (part.partKind !== question.kind || part.status.kind !== "live") return [];
    const checked = question.state["~standard"].validate(part.state);

    if (checked instanceof Promise || checked.issues !== undefined) return [];

    return [{ part: part.id, prompt: checked.value.prompt, options: checked.value.options }];
  });
}

/** Returns the token counts and cost of every completed run this view holds. */
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

/** Whether a heading asserts a verb: present while open, past once done on its own, none otherwise. */
export type ToolTense = "running" | "past" | "none";

/** The colour role a call's state takes. */
export type ToolTone = "running" | "attention" | "success" | "failure" | "stopped";

/** A tool call's state in words: tense, tone and the word a card shows after its subject. */
export interface ToolStatus {
  readonly tense: ToolTense;
  readonly tone: ToolTone;
  readonly word: string | undefined;
}

const RUNNING: ToolStatus = { tense: "running", tone: "running", word: undefined };

/**
 * Returns the one reading of a tool call every surface draws, from its phase,
 * its outcome and the part's status. A verb appears only when it is true; a
 * call parked on the user's answer needs input.
 */
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

/** Returns what a settled call said in text, or a failed call's reason; empty while it runs. */
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

/** The inline composer token being completed: `@` for a file, `/` for a command. */
export interface CompletionTrigger {
  readonly kind: "@" | "/";
  /** Full token span; accepting a result replaces this range. */
  readonly start: number;
  readonly end: number;
  /** Text between the trigger and the caret. */
  readonly query: string;
}

/**
 * Returns the `@` or `/` token under the caret. A trigger character inside a
 * word is text; the replacement range runs through the token's whole tail.
 */
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

/**
 * Reads a watch until the returned disposer runs: each value goes to `next`,
 * a failure to `fail`. The terminal's one wrapper over `watch()`; the
 * disposer returns the iterator, which closes the stream.
 */
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

/** Returns true when a message is the model's prose, narrowing its state. */
export function isTextMessage(
  message: Message,
): message is PartMessage & { readonly state: PartState<typeof text> } {
  return isPart(message, text);
}

/** Returns true when a message is a thought, narrowing its state. */
export function isThinkingMessage(
  message: Message,
): message is PartMessage & { readonly state: PartState<typeof thinking> } {
  return isPart(message, thinking);
}
