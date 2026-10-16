import { openQuestions } from "@nyte-ai/plugin/question/schema";
import type { OpenQuestion, QuestionAnswers, QuestionInfo } from "@nyte-ai/plugin/question/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { useMutation } from "@tanstack/react-query";
import { createContext, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useChildSessions, useSessionView } from "../../queries.ts";
import { connection, sessionWatch } from "../../sdk.tsx";
import { sameComposerDocument } from "../composer-document.ts";
import type { ComposerDocumentState } from "../composer-document.ts";

const EMPTY_DOCUMENT: ComposerDocumentState = { text: "", selectionStart: 0, selectionEnd: 0 };

type FieldDraft =
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

interface RequestDraft {
  readonly sessionId: SessionId;
  readonly part: OpenQuestion["part"];
  readonly current: number;
  readonly fields: readonly FieldDraft[];
}

export async function answerQuestion(
  sessionId: SessionId,
  question: OpenQuestion,
  answers: QuestionAnswers,
): Promise<void> {
  const outcome = await connection()
    .session(sessionId)
    .part(question.part)
    .act("answer", { answers });

  switch (outcome.kind) {
    case "ok":
      return;
    case "rejected":
      throw new Error(outcome.reason);
    case "failed":
      throw new Error(outcome.message);
    case "no-owner":
      throw new Error("This host cannot answer these questions yet.");
    case "unknown-action":
      throw new Error("Question answers are unavailable on this host.");
    case "closed":
      throw new Error("This question is no longer waiting.");
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}

function fieldAnswers(field: FieldDraft): string[] {
  const custom = field.document.text.trim();

  if (field.kind === "multiple")
    return Array.from(
      new Set([...field.options.map((label) => label.trim()), ...(custom !== "" ? [custom] : [])]),
    );

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

export interface QuestionDock {
  readonly request: OpenQuestion;
  readonly field: QuestionInfo;
  readonly origin: string | undefined;
  readonly current: number;
  readonly total: number;
  readonly last: boolean;
  readonly document: ComposerDocumentState;
  readonly pending: boolean;
  readonly settled: boolean;
  readonly error: string | undefined;
  readonly answered: readonly boolean[];
  readonly isSelected: (label: string) => boolean;
  readonly select: (label: string) => void;
  readonly changeDocument: (document: ComposerDocumentState) => void;
  readonly jump: (index: number) => void;
  readonly advance: (document?: ComposerDocumentState) => Promise<void>;
  readonly dismiss: () => Promise<void>;
}

export const QuestionDockContext = createContext<QuestionDock | undefined>(undefined);

function observeQuestionViews(stores: readonly ReturnType<typeof sessionWatch>[]) {
  let views = stores.map((store) => store.value);

  return {
    subscribe: (notify: () => void) => {
      const leave = stores.map((store) => store.subscribe(notify));

      return () => {
        for (const unsubscribe of leave) unsubscribe();
      };
    },
    snapshot: () => {
      const next = stores.map((store) => store.value);

      if (next.some((view, index) => view !== views[index])) views = next;

      return views;
    },
  };
}

export function useQuestionDock(sessionId: SessionId): QuestionDock | undefined {
  const view = useSessionView(sessionId);
  const own = useMemo(() => openQuestions(view), [view]);
  const children = useChildSessions(sessionId);

  const watched = useMemo(
    () =>
      (children.data ?? []).flatMap((child) => {
        const execution = child.heads[0]?.execution;

        return execution?.kind === "waiting" && execution.on.kind === "part"
          ? [{ child, store: sessionWatch(child.id) }]
          : [];
      }),
    [children.data],
  );

  const observation = useMemo(
    () => observeQuestionViews(watched.map(({ store }) => store)),
    [watched],
  );

  const childViews = useSyncExternalStore(
    observation.subscribe,
    observation.snapshot,
    observation.snapshot,
  );

  const requests = useMemo(
    () => [
      ...own.map((request) => ({ sessionId, request, origin: undefined })),
      ...watched.flatMap(({ child }, index) =>
        openQuestions(childViews[index]).map((request) => ({
          sessionId: child.id,
          request,
          origin: child.name ?? "a subagent",
        })),
      ),
    ],
    [own, sessionId, watched, childViews],
  );

  const [stored, setStored] = useState<readonly RequestDraft[]>([]);

  const recent = stored.findLast((draft) =>
    requests.some(
      (request) => request.sessionId === draft.sessionId && request.request.part === draft.part,
    ),
  );

  const active =
    requests.find(
      (request) => request.sessionId === recent?.sessionId && request.request.part === recent.part,
    ) ?? requests[0];

  const save = (next: RequestDraft): void => {
    setStored((current) => [
      ...current.filter((draft) => draft.sessionId !== next.sessionId || draft.part !== next.part),
      next,
    ]);
  };

  const submitting = useRef(false);

  const reply = useMutation({
    mutationKey: ["question", sessionId, "answer"],
    retry: false,
    mutationFn: async (submission: {
      readonly sessionId: SessionId;
      readonly request: OpenQuestion;
      readonly answers: QuestionAnswers | null;
    }) => {
      if (submission.answers === null)
        await connection().session(submission.sessionId).part(submission.request.part).close();
      else await answerQuestion(submission.sessionId, submission.request, submission.answers);

      return { sessionId: submission.sessionId, part: submission.request.part };
    },
  });

  if (active === undefined) return undefined;

  const draft: RequestDraft =
    recent?.sessionId === active.sessionId && recent.part === active.request.part
      ? recent
      : {
          sessionId: active.sessionId,
          part: active.request.part,
          current: 0,
          fields: active.request.questions.map((field): FieldDraft =>
            field.multiple === true
              ? { kind: "multiple", options: [], document: EMPTY_DOCUMENT }
              : { kind: "single", selection: { kind: "empty" }, document: EMPTY_DOCUMENT },
          ),
        };

  const field = active.request.questions[draft.current];
  const selected = draft.fields[draft.current];

  if (field === undefined || selected === undefined) return undefined;

  const settled =
    reply.isSuccess &&
    reply.data.sessionId === active.sessionId &&
    reply.data.part === active.request.part;

  const pending = reply.isPending;
  const blocked = pending || settled;

  const customDocumentVisible =
    selected.kind === "multiple" || selected.selection.kind === "custom";

  const displayed = customDocumentVisible ? selected.document : EMPTY_DOCUMENT;

  const replace = (next: FieldDraft): void => {
    save({
      ...draft,
      fields: draft.fields.map((value, index) => (index === draft.current ? next : value)),
    });
  };

  const customDraft = (document: ComposerDocumentState): FieldDraft =>
    selected.kind === "multiple"
      ? { ...selected, document }
      : { ...selected, document, selection: { kind: "custom" } };

  const last = draft.current === draft.fields.length - 1;

  return {
    request: active.request,
    field,
    origin: active.origin,
    current: draft.current,
    total: draft.fields.length,
    last,
    document: displayed,
    pending,
    settled,
    error:
      reply.isError &&
      reply.variables.sessionId === active.sessionId &&
      reply.variables.request.part === active.request.part
        ? reply.error.message
        : undefined,
    answered: draft.fields.map((value) => fieldAnswers(value).length > 0),
    isSelected: (label) =>
      selected.kind === "multiple"
        ? selected.options.includes(label)
        : selected.selection.kind === "option" && selected.selection.label === label,
    select: (label) => {
      if (blocked || submitting.current) return;
      replace(
        selected.kind === "multiple"
          ? {
              ...selected,
              options: selected.options.includes(label)
                ? selected.options.filter((value) => value !== label)
                : [...selected.options, label],
            }
          : { ...selected, selection: { kind: "option", label } },
      );
    },
    changeDocument: (document) => {
      if (blocked || sameComposerDocument(document, displayed)) return;

      if (!customDocumentVisible && document.text === displayed.text) return;
      replace(customDraft(document));
    },
    jump: (current) => {
      if (!blocked && !submitting.current && draft.fields[current] !== undefined)
        save({ ...draft, current });
    },
    advance: async (document) => {
      if (blocked || submitting.current) return;

      const fields =
        document === undefined || document.text === displayed.text
          ? draft.fields
          : draft.fields.map((value, index) =>
              index === draft.current ? customDraft(document) : value,
            );

      const next = { ...draft, fields };

      if (!last) {
        save({ ...next, current: draft.current + 1 });

        return;
      }

      save(next);
      submitting.current = true;

      return reply
        .mutateAsync({
          sessionId: active.sessionId,
          request: active.request,
          answers: fields.map(fieldAnswers),
        })
        .then(() => undefined)
        .finally(() => {
          submitting.current = false;
        });
    },
    dismiss: async () => {
      if (blocked || submitting.current) return;
      submitting.current = true;

      return reply
        .mutateAsync({
          sessionId: active.sessionId,
          request: active.request,
          answers: null,
        })
        .then(() => undefined)
        .finally(() => {
          submitting.current = false;
        });
    },
  };
}
