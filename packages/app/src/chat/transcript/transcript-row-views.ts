import type { CommitId, MessageSource, UserContent } from "@nyte-ai/sdk";
import { showsAnswer, showsReport } from "@nyte-ai/plugin/client/presentation";
import type { AnswerMessage, UserMessage } from "@nyte-ai/plugin/client/presentation";
import { stepEntries } from "./step-entries.ts";
import type { StepEntry } from "./step-entries.ts";
import { workedFor } from "./transcript-presentation.ts";
import type { PromptRow, TranscriptRow, TurnItemRow } from "./transcript-rows.ts";

type StepRow = Extract<TurnItemRow, { readonly kind: "step" }>;

type ResponseRow = Extract<TurnItemRow, { readonly kind: "response" }>;

type PartRow = Extract<TurnItemRow, { readonly kind: "part" }>;

export type StepRowView =
  | { readonly kind: "entry"; readonly entry: StepEntry }
  | { readonly kind: "group" };

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

/** A step that stopped running with one entry other than a thought draws that entry alone. */
export function stepRowView(row: StepRow): StepRowView {
  const entries = stepEntries(row.messages, true);
  const only = entries[0];

  if (!row.running && entries.length === 1 && only !== undefined && only.kind !== "thinking")
    return { kind: "entry", entry: only };

  return { kind: "group" };
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
