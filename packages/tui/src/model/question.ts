import type { SessionId, SessionView } from "@nyte-ai/sdk";
import { openQuestions } from "@nyte-ai/plugin/question/schema";
import type { QuestionAnswers, QuestionInfo } from "@nyte-ai/plugin/question/schema";
import { shortId } from "../lib/format.ts";
import type { Task } from "../lib/tasks.ts";
import type { ListDialog } from "./dialogs/list.ts";
import type { QuestionDraft, QuestionFieldDraft, QuestionLocal, QuestionRequest } from "./state.ts";

export interface QuestionModel extends QuestionRequest {
  readonly questions: readonly QuestionInfo[];
  readonly field: QuestionInfo;
  readonly index: number;
  readonly owner: { readonly kind: "head" } | { readonly kind: "child"; readonly short: string };
  readonly panel: boolean;
}

export function sameQuestion(
  left: QuestionRequest | null | undefined,
  right: QuestionRequest | null | undefined,
): boolean {
  return left?.session === right?.session && left?.part === right?.part;
}

export function readQuestionDraft(
  local: QuestionLocal,
  request: QuestionRequest,
): QuestionDraft | undefined {
  return local.drafts.get(request.session)?.get(request.part);
}

export function storeQuestionDraft(
  local: QuestionLocal,
  request: QuestionRequest,
  draft: QuestionDraft,
): QuestionLocal {
  const drafts = new Map(local.drafts);

  const session = new Map(drafts.get(request.session));
  session.set(request.part, draft);
  drafts.set(request.session, session);

  return { ...local, drafts };
}

function createFieldDraft(field: QuestionInfo): QuestionFieldDraft {
  return field.multiple === true
    ? { kind: "multiple", options: [], customText: "", customSelected: false }
    : { kind: "single", selection: { kind: "empty" }, customText: "" };
}

/** The draft of `question` while it is still being answered, or `null` once its answers are sent. */
export function editingQuestionDraft(
  local: QuestionLocal,
  question: QuestionModel,
): QuestionDraft | null {
  const draft = readQuestionDraft(local, question) ?? {
    active: 0,
    fields: question.questions.map(createFieldDraft),
    phase: "editing",
  };

  return draft.phase === "editing" ? draft : null;
}

export function selectQuestionAnswer(
  field: QuestionFieldDraft,
  value: string,
  typed: boolean,
): QuestionFieldDraft {
  if (field.kind === "multiple")
    return typed
      ? { ...field, customText: value, customSelected: true }
      : {
          ...field,
          options: field.options.includes(value)
            ? field.options.filter((option) => option !== value)
            : [...field.options, value],
        };

  return {
    ...field,
    selection: typed ? { kind: "custom" } : { kind: "option", value },
    customText: typed ? value : field.customText,
  };
}

export function collectQuestionAnswers(draft: QuestionDraft): QuestionAnswers {
  return draft.fields.map((field) => {
    const custom = field.customText.trim();

    if (field.kind === "multiple")
      return [
        ...new Set([...field.options, ...(field.customSelected && custom !== "" ? [custom] : [])]),
      ];

    if (field.selection.kind === "option") return [field.selection.value];

    return field.selection.kind === "custom" && custom !== "" ? [custom] : [];
  });
}

export function currentQuestion(
  head: { readonly id: SessionId; readonly view: SessionView | null } | null,
  tasks: readonly Task[],
  local: QuestionLocal,
): QuestionModel | null {
  const owners = [
    ...(head === null
      ? []
      : [{ session: head.id, view: head.view ?? undefined, owner: { kind: "head" as const } }]),
    ...tasks.flatMap((task) =>
      task.kind === "agent" && task.view !== undefined
        ? [
            {
              session: task.id,
              view: task.view,
              owner: { kind: "child" as const, short: shortId(task.id) },
            },
          ]
        : [],
    ),
  ];

  for (const owner of owners) {
    for (const request of openQuestions(owner.view)) {
      const identity = { session: owner.session, part: request.part };

      const draft = readQuestionDraft(local, identity);

      if (draft?.phase === "answered") continue;

      const index = draft?.active ?? 0;

      const field = request.questions[index];

      if (field === undefined) continue;

      return {
        ...request,
        ...identity,
        field,
        index,
        owner: owner.owner,
        panel: !sameQuestion(identity, local.dismissed),
      };
    }
  }

  return null;
}

export function questionTitle(question: QuestionModel): string {
  return question.owner.kind === "head"
    ? question.field.question
    : `Subagent ${question.owner.short}: ${question.field.question}`;
}

export function questionPanel(
  question: QuestionModel | null,
  local: QuestionLocal,
): ListDialog | null {
  if (question === null || !question.panel) return null;

  const draft = readQuestionDraft(local, question);

  const field = draft?.fields[question.index] ?? createFieldDraft(question.field);

  const customSelected =
    field.kind === "multiple" ? field.customSelected : field.selection.kind === "custom";

  const options = question.field.options.map((option, index) => ({
    id: `option:${index}`,
    label: option.label,
    description: option.description,
    timing: null,
    status: null,
    mark: {
      glyph: (
        field.kind === "multiple"
          ? field.options.includes(option.label)
          : field.selection.kind === "option" && field.selection.value === option.label
      )
        ? "✓"
        : "○",
      tone: "dim" as const,
    },
  }));

  const actions = [
    {
      id: "custom",
      label: "Type an answer",
      description: field.customText,
      timing: null,
      status: null,
      mark: { glyph: customSelected ? "✓" : "○", tone: "dim" as const },
    },
    {
      id: "next",
      label: question.index === question.questions.length - 1 ? "Submit" : "Next",
      description: "",
      timing: null,
      status: null,
      mark: null,
    },
    ...(question.index > 0
      ? [{ id: "back", label: "Back", description: "", timing: null, status: null, mark: null }]
      : []),
  ];

  const progress =
    question.questions.length > 1 ? `${question.index + 1}/${question.questions.length} · ` : "";

  return {
    kind: "list",
    id: `question:${question.part}`,
    purpose: { kind: "question", session: question.session, part: question.part },
    title: `${progress}${questionTitle(question)}`,
    choices: { kind: "ready", items: [...options, ...actions] },
    query: "",
    highlighted: local.highlighted,
    detailScroll:
      local.detailScroll?.part === question.part && local.detailScroll.index === question.index
        ? local.detailScroll.request
        : undefined,
    answering: null,
    busy: draft?.phase === "submitting",
  };
}
