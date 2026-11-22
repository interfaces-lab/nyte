import type { OpenQuestion, QuestionAnswers, QuestionInfo } from "@nyte-ai/plugin/question/schema";
import type { PartId, SessionId } from "@nyte-ai/sdk";
import { sameComposerDocument } from "../composer/composer-document.ts";
import type { ComposerDocumentState } from "../composer/composer-document.ts";
import type { Ask } from "./asks.ts";

export type FieldDraft =
  | {
      readonly kind: "single";
      readonly selection:
        | { readonly kind: "empty" }
        | { readonly kind: "option"; readonly label: string }
        | { readonly kind: "custom" };
      readonly document: ComposerDocumentState;
    }
  | {
      readonly kind: "multiple";
      readonly options: readonly string[];
      readonly document: ComposerDocumentState;
    };

export interface RequestDraft {
  readonly sessionId: SessionId;
  readonly part: PartId;
  readonly current: number;
  readonly fields: readonly FieldDraft[];
}

export type Reply =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "sent"; readonly sessionId: SessionId; readonly part: PartId }
  | {
      readonly kind: "failed";
      readonly sessionId: SessionId;
      readonly part: PartId;
      readonly message: string;
    };

export interface DockView {
  readonly asks: readonly Ask<OpenQuestion>[];
  readonly ask: Ask<OpenQuestion>;
  readonly draft: RequestDraft;
  readonly field: QuestionInfo;
  readonly selected: FieldDraft;
  readonly document: ComposerDocumentState;
  readonly customVisible: boolean;
  readonly chosen: readonly string[];
  readonly last: boolean;
  readonly pending: boolean;
  readonly settled: boolean;
  readonly blocked: boolean;
  readonly error: string | undefined;
  readonly answered: readonly boolean[];
}

export type DockEvent =
  | { readonly kind: "select"; readonly label: string }
  | { readonly kind: "document"; readonly document: ComposerDocumentState }
  | { readonly kind: "jump"; readonly index: number }
  | { readonly kind: "advance"; readonly document: ComposerDocumentState | undefined }
  | { readonly kind: "dismiss" };

export type DockOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "blocked" }
  | { readonly kind: "kept" }
  | { readonly kind: "next" }
  | { readonly kind: "send"; readonly answers: QuestionAnswers | null };

export interface DockStep {
  readonly drafts: readonly RequestDraft[];
  readonly outcome: DockOutcome;
}

const EMPTY_DOCUMENT: ComposerDocumentState = { text: "", selectionStart: 0, selectionEnd: 0 };

export function dockView(
  asks: readonly Ask<OpenQuestion>[],
  drafts: readonly RequestDraft[],
  reply: Reply,
): DockView | undefined {
  const recent = drafts.findLast((draft) => asks.some((ask) => draftFor(draft, ask)));

  const ask =
    asks.find((candidate) => recent !== undefined && draftFor(recent, candidate)) ?? asks[0];

  if (ask === undefined) return undefined;

  const draft =
    recent !== undefined && draftFor(recent, ask)
      ? recent
      : {
          sessionId: ask.sessionId,
          part: ask.request.part,
          current: 0,
          fields: ask.request.questions.map((field): FieldDraft =>
            field.multiple === true
              ? { kind: "multiple", options: [], document: EMPTY_DOCUMENT }
              : { kind: "single", selection: { kind: "empty" }, document: EMPTY_DOCUMENT },
          ),
        };

  const field = ask.request.questions[draft.current];
  const selected = draft.fields[draft.current];

  if (field === undefined || selected === undefined) return undefined;

  const settled =
    reply.kind === "sent" && reply.sessionId === ask.sessionId && reply.part === ask.request.part;

  const pending = reply.kind === "pending";
  const customVisible = selected.kind === "multiple" || selected.selection.kind === "custom";

  return {
    asks,
    ask,
    draft,
    field,
    selected,
    document: customVisible ? selected.document : EMPTY_DOCUMENT,
    customVisible,
    chosen: chosenLabels(selected),
    last: draft.current === draft.fields.length - 1,
    pending,
    settled,
    blocked: pending || settled,
    error:
      reply.kind === "failed" &&
      reply.sessionId === ask.sessionId &&
      reply.part === ask.request.part
        ? reply.message
        : undefined,
    answered: draft.fields.map((value) => fieldAnswers(value).length > 0),
  };
}

export function stepDock(
  view: DockView,
  drafts: readonly RequestDraft[],
  event: DockEvent,
): DockStep {
  const draft = view.draft;
  const selected = view.selected;

  if (view.blocked) return { drafts, outcome: { kind: "blocked" } };

  switch (event.kind) {
    case "select":
      return keep(
        view,
        drafts,
        withField(
          draft,
          selected.kind === "multiple"
            ? {
                ...selected,
                options: selected.options.includes(event.label)
                  ? selected.options.filter((value) => value !== event.label)
                  : [...selected.options, event.label],
              }
            : { ...selected, selection: { kind: "option", label: event.label } },
        ),
      );
    case "document":
      if (sameComposerDocument(event.document, view.document)) return none(drafts);

      if (!view.customVisible && event.document.text === view.document.text) return none(drafts);

      return keep(view, drafts, withField(draft, customDraft(selected, event.document)));
    case "jump":
      return draft.fields[event.index] === undefined
        ? none(drafts)
        : keep(view, drafts, { ...draft, current: event.index });
    case "advance": {
      const typed = event.document;

      const fields =
        typed === undefined || typed.text === view.document.text
          ? draft.fields
          : withField(draft, customDraft(selected, typed)).fields;

      if (!view.last) {
        return {
          drafts: saveDraft(view, drafts, { ...draft, fields, current: draft.current + 1 }),
          outcome: { kind: "next" },
        };
      }

      return {
        drafts: saveDraft(view, drafts, { ...draft, fields }),
        outcome: { kind: "send", answers: fields.map(fieldAnswers) },
      };
    }

    case "dismiss":
      return { drafts, outcome: { kind: "send", answers: null } };
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}

export function fieldAnswers(field: FieldDraft): string[] {
  const custom = field.document.text.trim();

  if (field.kind === "multiple") {
    return Array.from(
      new Set([...field.options.map((label) => label.trim()), ...(custom !== "" ? [custom] : [])]),
    );
  }

  switch (field.selection.kind) {
    case "empty":
      return [];
    case "option":
      return [field.selection.label];
    case "custom":
      return custom === "" ? [] : [custom];
    default: {
      const exhaustive: never = field.selection;

      return exhaustive;
    }
  }
}

function draftFor(draft: RequestDraft, ask: Ask<OpenQuestion>): boolean {
  return ask.sessionId === draft.sessionId && ask.request.part === draft.part;
}

function chosenLabels(field: FieldDraft): readonly string[] {
  if (field.kind === "multiple") return field.options;

  return field.selection.kind === "option" ? [field.selection.label] : [];
}

function customDraft(selected: FieldDraft, document: ComposerDocumentState): FieldDraft {
  return selected.kind === "multiple"
    ? { ...selected, document }
    : { ...selected, document, selection: { kind: "custom" } };
}

function withField(draft: RequestDraft, next: FieldDraft): RequestDraft {
  return {
    ...draft,
    fields: draft.fields.map((value, index) => (index === draft.current ? next : value)),
  };
}

function saveDraft(
  view: DockView,
  drafts: readonly RequestDraft[],
  next: RequestDraft,
): readonly RequestDraft[] {
  return [
    ...drafts.filter(
      (draft) =>
        (draft.sessionId !== next.sessionId || draft.part !== next.part) &&
        view.asks.some((ask) => draftFor(draft, ask)),
    ),
    next,
  ];
}

function keep(view: DockView, drafts: readonly RequestDraft[], next: RequestDraft): DockStep {
  return { drafts: saveDraft(view, drafts, next), outcome: { kind: "kept" } };
}

function none(drafts: readonly RequestDraft[]): DockStep {
  return { drafts, outcome: { kind: "none" } };
}
