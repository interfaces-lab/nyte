import { SdkError } from "@nyte-ai/sdk";
import type {
  ActOutcome,
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

/**
 * Returns one head of a session as the chat draws it: the `SessionView` its
 * watch yields, the directory row for the name and pin, and the writes a
 * screen makes on it. Sends go through the sdk's journal, so a message the
 * phone could not deliver shows unsent and is resent on the next connect.
 */
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

  /** Answers the open question with a choice; undefined when the host could not be asked. */
  const reply = useCallback(
    async (part: PartId, choice: string): Promise<ActOutcome<unknown> | undefined> => {
      try {
        return await session.part(part).act("answer", { choice });
      } catch {
        return undefined;
      }
    },
    [session],
  );

  /** Records a canvas failure on its part; a host that cannot be told is left alone. */
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
