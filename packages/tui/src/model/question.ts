/**
 * The one current question. `openQuestions(view)` from
 * `@nyte-ai/plugin/question` is the only rule for "still open". The head's own
 * questions come first, then a child's (from the task views). The panel, the
 * placeholder, Enter's meaning and the OSC 7501 status all read this value.
 */
import type { PartId, SessionId, SessionView } from "@nyte-ai/sdk";
import { openQuestions } from "@nyte-ai/plugin/question";
import { shortId } from "../lib/format.ts";
import type { Task } from "../lib/tasks.ts";
import type { ListDialog } from "./dialogs/list.ts";
import type { QuestionLocal } from "./state.ts";

export interface QuestionModel {
  readonly session: SessionId;
  readonly part: PartId;
  readonly prompt: string;
  readonly options: readonly string[];
  /** "head", or the child's short id for "Subagent <short>: …". */
  readonly owner: { readonly kind: "head" } | { readonly kind: "child"; readonly short: string };
  /** The panel shows unless the user pressed Esc on this very part. */
  readonly panel: boolean;
}

export function currentQuestion(
  head: { readonly id: SessionId; readonly view: SessionView | null } | null,
  tasks: readonly Task[],
  local: QuestionLocal,
): QuestionModel | null {
  const own = head?.view === null || head === null ? undefined : openQuestions(head.view)[0];

  if (head !== null && own !== undefined)
    return {
      session: head.id,
      ...own,
      owner: { kind: "head" },
      panel: own.part !== local.dismissed,
    };

  for (const task of tasks) {
    if (task.kind !== "agent" || task.view === undefined) continue;
    const asked = openQuestions(task.view)[0];

    if (asked !== undefined)
      return {
        session: task.id,
        ...asked,
        owner: { kind: "child", short: shortId(task.id) },
        panel: asked.part !== local.dismissed,
      };
  }

  return null;
}

/** The panel's title: the prompt, named for a subagent's question. */
export function questionTitle(question: QuestionModel): string {
  return question.owner.kind === "head"
    ? question.prompt
    : `Subagent ${question.owner.short}: ${question.prompt}`;
}

/**
 * The question panel as the list dialog it is drawn and reduced as. It is
 * derived, never pushed: a question that opens while another dialog is up
 * shows as soon as the stack empties.
 */
export function questionPanel(
  question: QuestionModel | null,
  local: QuestionLocal,
): ListDialog | null {
  if (question === null || !question.panel) return null;

  return {
    kind: "list",
    id: `question:${question.part}`,
    purpose: { kind: "question", session: question.session, part: question.part, typed: true },
    title: questionTitle(question),
    choices: {
      kind: "ready",
      items: question.options.map((option) => ({
        id: option,
        label: option,
        description: "",
        status: null,
        mark: null,
      })),
    },
    query: local.query,
    highlighted: local.highlighted,
    answering: local.answering ?? "",
    busy: false,
  };
}
