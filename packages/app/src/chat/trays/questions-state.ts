import { openQuestions } from "@nyte-ai/plugin/question/schema";
import type { OpenQuestion, QuestionAnswers, QuestionInfo } from "@nyte-ai/plugin/question/schema";
import type { PartId, SessionId } from "@nyte-ai/sdk";
import { useMutation } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { createContext, useRef, useState } from "react";
import { useWaitingDescendants } from "../../chats/index.ts";
import { connection } from "../../data/connection.ts";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import type { ComposerDocumentState } from "../composer/composer-document.ts";
import { openAsks, requireAnswered } from "./asks.ts";
import { dockView, stepDock } from "./question-dock.ts";
import type { DockEvent, DockOutcome, Reply, RequestDraft } from "./question-dock.ts";

export async function answerQuestion(
  sessionId: SessionId,
  question: OpenQuestion,
  answers: QuestionAnswers | null,
): Promise<void> {
  const part = connection().session(sessionId).part(question.part);
  requireAnswered(
    await (answers === null ? part.act("skip", {}) : part.act("answer", { answers })),
    "question",
  );
}

interface Submission {
  readonly sessionId: SessionId;
  readonly request: OpenQuestion;
  readonly answers: QuestionAnswers | null;
}

const BLOCKED = { kind: "blocked" } as const;

export type QuestionOutcome =
  | { readonly kind: "blocked" }
  | { readonly kind: "next" }
  | { readonly kind: "sent" }
  | { readonly kind: "failed" };

export interface QuestionDock {
  readonly request: OpenQuestion;
  readonly field: QuestionInfo;
  readonly origin: { readonly title: string; readonly sessionId: SessionId } | undefined;
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
  readonly advance: (document?: ComposerDocumentState) => Promise<QuestionOutcome>;
  readonly dismiss: () => Promise<Exclude<QuestionOutcome, { readonly kind: "next" }>>;
}

export const QuestionDockContext = createContext<QuestionDock | undefined>(undefined);

export function useQuestionDock(sessionId: SessionId): QuestionDock | undefined {
  const parts = useWatchSelect(chatStore(sessionId), (state) => state.value?.parts);
  const waiting = useWaitingDescendants(sessionId);

  const [stored, setStored] = useState<readonly RequestDraft[]>([]);

  const submitting = useRef(false);

  const reply = useMutation({
    mutationKey: ["question", sessionId, "answer"],
    retry: false,
    mutationFn: async (submission: Submission) => {
      await answerQuestion(submission.sessionId, submission.request, submission.answers);

      return { sessionId: submission.sessionId, part: submission.request.part };
    },
  });

  const requests = openAsks(openQuestions, { sessionId, parts }, waiting);

  const view = dockView(requests, stored, replyState(reply));

  if (view === undefined) return undefined;

  const step = (event: DockEvent): DockOutcome => {
    const next = stepDock(view, stored, event);

    if (next.drafts !== stored) setStored((current) => stepDock(view, current, event).drafts);

    return next.outcome;
  };

  const sendReply = (outcome: DockOutcome) => {
    if (outcome.kind !== "send") return Promise.resolve(BLOCKED);

    submitting.current = true;

    return reply
      .mutateAsync({
        sessionId: view.ask.sessionId,
        request: view.ask.request,
        answers: outcome.answers,
      })
      .then(
        () => ({ kind: "sent" }) as const,
        () => ({ kind: "failed" }) as const,
      )
      .finally(() => {
        submitting.current = false;
      });
  };

  return {
    request: view.ask.request,
    field: view.field,
    origin: view.ask.origin,
    current: view.draft.current,
    total: view.draft.fields.length,
    last: view.last,
    document: view.document,
    pending: view.pending,
    settled: view.settled,
    error: view.error,
    answered: view.answered,
    isSelected: (label) => view.chosen.includes(label),
    select: (label) => {
      if (!submitting.current) step({ kind: "select", label });
    },
    changeDocument: (document) => {
      step({ kind: "document", document });
    },
    jump: (index) => {
      if (!submitting.current) step({ kind: "jump", index });
    },
    advance: async (document) => {
      if (submitting.current) return BLOCKED;

      const outcome = step({ kind: "advance", document });

      return outcome.kind === "next" ? { kind: "next" } : sendReply(outcome);
    },
    dismiss: async () => {
      if (submitting.current) return BLOCKED;

      return sendReply(step({ kind: "dismiss" }));
    },
  };
}

function replyState(
  mutation: UseMutationResult<
    { readonly sessionId: SessionId; readonly part: PartId },
    Error,
    Submission
  >,
): Reply {
  if (mutation.isPending) return { kind: "pending" };

  if (mutation.isSuccess)
    return { kind: "sent", sessionId: mutation.data.sessionId, part: mutation.data.part };

  if (mutation.isError)
    return {
      kind: "failed",
      sessionId: mutation.variables.sessionId,
      part: mutation.variables.request.part,
      message: mutation.error.message,
    };

  return { kind: "idle" };
}
