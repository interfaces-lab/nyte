import type { CommitId, MessageSource, UserContent } from "@nyte-ai/sdk";
import { showsAnswer, showsReport } from "@nyte-ai/plugin/client/presentation";
import type {
  AnswerMessage,
  ThinkingMessage,
  UserMessage,
} from "@nyte-ai/plugin/client/presentation";
import { reasoningHeading } from "./reasoning-heading.ts";
import { stepGroupFacts } from "./step-group-presentation.ts";
import type { StepGroupFacts } from "./step-group-presentation.ts";
import type { StepEntry } from "./step-entries.ts";
import { workedFor } from "./transcript-presentation.ts";
import type { PromptRow, TranscriptRow, TurnItemRow } from "./transcript-rows.ts";

type ChangesRow = Extract<TranscriptRow, { readonly kind: "changes" }>;

type StepRow = Extract<TurnItemRow, { readonly kind: "step" }>;

type ResponseRow = Extract<TurnItemRow, { readonly kind: "response" }>;

type PartRow = Extract<TurnItemRow, { readonly kind: "part" }>;

export type StepRowView =
  | { readonly kind: "entry"; readonly entry: StepEntry }
  | { readonly kind: "group"; readonly facts: StepGroupFacts };

export interface ResponseRowView {
  readonly markdown: string;
  readonly streaming: boolean;
  readonly at: number;
  readonly ended: boolean;
  readonly latest: boolean;
  readonly worked: string | undefined;
  readonly commit: CommitId | undefined;
}

/** A prompt row's report or answer sits in the live turn's frame; a part row's sits in its turn. */
export type UserRowView =
  | {
      readonly kind: "report";
      readonly source: Extract<MessageSource, { readonly kind: "child" | "job" }>;
      readonly content: UserContent;
      readonly held: boolean;
      readonly wrapped: boolean;
    }
  | {
      readonly kind: "answer";
      readonly message: AnswerMessage;
      readonly held: boolean;
      readonly wrapped: boolean;
    }
  | {
      readonly kind: "user";
      readonly message: UserMessage;
      readonly content: UserContent;
      readonly pending: boolean;
      readonly editable: boolean;
    };

/**
 * A step that stopped running with one entry other than a thought draws that entry alone. A row
 * with a step besides thoughts merges its thoughts, so the entries that decide this are the ones
 * the group would draw.
 */
export function stepRowView(row: StepRow): StepRowView {
  const facts = stepGroupFacts(row.messages, row.running);
  const only = facts.entries[0];

  if (!row.running && facts.entries.length === 1 && only !== undefined && only.kind !== "thinking")
    return { kind: "entry", entry: only };

  return { kind: "group", facts };
}

export function responseRowView(row: ResponseRow): ResponseRowView | null {
  const markdown = row.messages.map((message) => message.state.markdown.trim()).join("\n\n");
  const first = row.messages[0];

  if (markdown === "" || first === undefined) return null;

  return {
    markdown,
    streaming: row.messages.some((message) => message.status.kind === "live"),
    at: first.at,
    ended: row.ended,
    latest: row.ended && row.latest,
    worked: row.ended && row.workedMs !== undefined ? workedFor(row.workedMs) : undefined,
    commit: row.messages
      .flatMap((message) => (message.status.kind === "settled" ? [message.status.commit] : []))
      .at(-1),
  };
}

export function userRowView(row: PromptRow | PartRow): UserRowView | undefined {
  const message = row.message;

  if (message.kind !== "user") return undefined;
  const prompt = row.kind === "prompt";
  const held = row.kind === "prompt" && row.held;

  if (showsReport(message))
    return {
      kind: "report",
      source: message.source,
      content: message.content,
      held,
      wrapped: prompt,
    };

  if (showsAnswer(message)) return { kind: "answer", message, held, wrapped: prompt };

  return {
    kind: "user",
    message,
    content: message.source.kind === "action" ? message.source.label : message.content,
    pending: row.kind === "prompt" && row.pending,
    editable: !prompt && message.source.kind !== "action",
  };
}

/** While an edit is saved, the turn's changes wait and an idle live row plans. */
export function shownRow(row: TranscriptRow, navigating: boolean): TranscriptRow {
  if (!navigating) return row;

  if (row.kind === "changes" && row.state !== "pending") return { ...row, state: "pending" };

  if (row.kind === "live" && row.state === "idle") return { ...row, state: "planning" };

  return row;
}

/**
 * How a thought line draws. While it streams it reads "Thinking" over its whole text. Once it
 * ends it folds under its heading, or "Thought" without one, and unfolds under that label when it
 * was shown while its group ran. A thought with no text left under its label draws the label alone,
 * and an empty one that ended draws nothing.
 */
export type ThoughtView =
  | { readonly kind: "label"; readonly streaming: boolean; readonly label: string }
  | {
      readonly kind: "folded" | "unfolded";
      readonly streaming: boolean;
      readonly label: string;
      readonly body: string;
    };

export function thoughtView(
  message: ThinkingMessage,
  markdown: string,
  unfolded: boolean,
): ThoughtView | null {
  const streaming = message.status.kind === "live";

  if (markdown.trim() === "" && !streaming) return null;
  const split = streaming || unfolded ? undefined : reasoningHeading(markdown);
  const label = streaming ? "Thinking" : (split?.title ?? "Thought");
  const body = split === undefined ? markdown : split.body;

  if (body.trim() === "") return { kind: "label", streaming, label };

  return { kind: unfolded ? "unfolded" : "folded", streaming, label, body };
}

export interface ThoughtProse {
  readonly markdown: string;
  readonly streaming: boolean;
}

/** A thought drawn bare in a group of thoughts: once it ends, without the heading the group's line already shows. */
export function thoughtProse(
  message: ThinkingMessage,
  markdown: string,
  titled: boolean,
): ThoughtProse {
  const streaming = message.status.kind === "live";

  return { markdown: titled && !streaming ? reasoningHeading(markdown).body : markdown, streaming };
}

/** The turn's summary row: a reservation while the turn works, the card once it ended with changes, else nothing. */
export type ChangesRowView =
  | { readonly kind: "reserved" }
  | { readonly kind: "card"; readonly files: ChangesRow["files"] };

export function changesRowView(row: ChangesRow): ChangesRowView | null {
  if (row.state === "pending") return { kind: "reserved" };

  return row.files.length > 0 ? { kind: "card", files: row.files } : null;
}
