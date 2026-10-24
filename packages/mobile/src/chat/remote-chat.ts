import { SdkError } from "@nyte-ai/sdk";
import type { QuestionAnswers } from "@nyte-ai/plugin/question/schema";
import type {
  ActOutcome,
  CommitId,
  Configuration,
  Connection,
  Delivery,
  HeadName,
  ModelInfo,
  ModelRef,
  PartId,
  SessionId,
} from "@nyte-ai/sdk";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { describeHostError } from "../connection/connection.ts";
import { useWatch } from "../connection/use-watch.ts";
import { uploadDraft, type DraftContent } from "../media/attachments.ts";

export function useRemoteChat(client: Connection, sessionId: SessionId, headName?: HeadName) {
  const session = useMemo(() => client.session(sessionId), [client, sessionId]);

  const head = useMemo(
    () => (headName === undefined ? session : session.head(headName)),
    [session, headName],
  );

  const [watched] = useWatch(head);
  const info = useQuery({ queryKey: ["session-info", sessionId], queryFn: () => session.info() });

  const state =
    watched.kind === "ready" ? watched.value : watched.kind === "failed" ? watched.last : undefined;

  const tip = state?.heads.find((entry) => entry.name === head.name)?.tip;

  const submission = useRef<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();

  const [modelSelection, setModelSelection] = useState<
    { kind: "saving"; model: ModelInfo } | { kind: "failed"; message: string } | undefined
  >(undefined);

  const send = useCallback(
    async (content: DraftContent, delivery?: Delivery): Promise<boolean> => {
      const empty =
        typeof content === "string"
          ? content.trim() === ""
          : !content.some((part) => (part.kind === "text" ? part.text.trim() !== "" : true));

      if (empty || sending) return false;
      setSending(true);
      setSendError(undefined);

      try {
        const workspace = client.workspace((await session.info()).workspace);
        const message = await uploadDraft(workspace, content);
        const receipt = await head.send(message, delivery === undefined ? undefined : { delivery });
        submission.current = receipt.message;

        return true;
      } catch (cause) {
        setSendError(
          cause instanceof Error && !(cause instanceof SdkError)
            ? cause.message
            : describeHostError(cause),
        );

        return false;
      } finally {
        setSending(false);
      }
    },
    [client, session, head, sending],
  );

  const selectModel = useCallback(
    async (model: ModelInfo): Promise<boolean> => {
      if (modelSelection?.kind === "saving") return false;
      setModelSelection({ kind: "saving", model });

      try {
        const outcome = await head.configure({ model: model.ref });

        if (outcome.kind === "configured") {
          setModelSelection(undefined);

          return true;
        }

        setModelSelection({
          kind: "failed",
          message:
            outcome.kind === "unknown-model"
              ? "That model is no longer available on your Mac. Refresh the model list."
              : "Your Mac couldn't apply that model choice.",
        });

        return false;
      } catch (cause) {
        setModelSelection({ kind: "failed", message: describeHostError(cause) });

        return false;
      }
    },
    [head, modelSelection],
  );

  const reply = useCallback(
    async (part: PartId, answers: QuestionAnswers): Promise<ActOutcome<unknown> | undefined> => {
      try {
        return await session.part(part).act("answer", { answers });
      } catch {
        return undefined;
      }
    },
    [session],
  );

  const report = useCallback(
    (part: PartId, message: string): void => {
      void session
        .part(part)
        .act("report", { message })
        .catch(() => undefined);
    },
    [session],
  );

  const [stopError, setStopError] = useState<string>();

  const stop = async (): Promise<void> => {
    const execution = state?.execution;

    if (execution === undefined || execution.kind === "idle") return;

    try {
      await session.run(execution.run.id).stop();
    } catch (cause) {
      setStopError(describeHostError(cause));
    }
  };

  const configuration: Configuration | null =
    state?.configuration.selected ?? state?.configuration.effective ?? null;

  const selectedModel: ModelRef | undefined =
    modelSelection?.kind === "saving" ? modelSelection.model.ref : configuration?.model;

  return {
    state,
    tip: tip?.kind === "commit" ? tip.id : undefined,
    see: (commit: CommitId) => head.see(commit),
    info: info.data,
    reloadInfo: info.refetch,
    configuration,
    sending,
    error:
      sendError ??
      stopError ??
      (watched.kind === "failed" ? describeHostError(watched.error) : undefined),
    send,
    getSubmissionKey: () => submission.current,
    reply,
    report,
    selectedModel,
    selectingModel: modelSelection?.kind === "saving",
    modelError: modelSelection?.kind === "failed" ? modelSelection.message : undefined,
    selectModel,
    stop,
  };
}
