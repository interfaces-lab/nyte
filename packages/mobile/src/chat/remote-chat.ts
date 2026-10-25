import { SdkError } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  Configuration,
  Connection,
  Delivery,
  HeadName,
  Message,
  ModelInfo,
  ModelRef,
  PartId,
  SessionId,
  UserContent,
} from "@nyte-ai/sdk";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { describeHostError } from "../connection/connection.ts";
import { useWatch } from "../connection/use-watch.ts";
import { uploadDraft, type DraftContent } from "../media/attachments.ts";

/** The host's answer to a message the SDK's journal holds: the message it became, or why the host refused it. */
export type SendAnswer =
  | { kind: "sent"; message: Message["id"] }
  | { kind: "refused"; error: string };

/**
 * `taken` once the photos are uploaded and the SDK's journal holds the message: the transcript shows it
 * from then on and the journal retries it while the host is unreachable, so the composer can let go.
 */
export type SendOutcome =
  | { kind: "taken"; answer: Promise<SendAnswer> }
  | { kind: "failed"; error: string }
  | { kind: "ignored" };

function describeSendError(cause: unknown): string {
  return cause instanceof Error && !(cause instanceof SdkError)
    ? cause.message
    : describeHostError(cause);
}

/**
 * A session's live view and what the conversation does to it. `sending` covers only the photo upload;
 * the SDK's journal serializes the sends after it. `withdraw` drops a message the host hasn't started
 * on, and `steerNow` moves a queued one into the running response.
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

  const tip = state?.heads.find((entry) => entry.name === head.name)?.tip;

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();

  const [modelSelection, setModelSelection] = useState<
    { kind: "saving"; model: ModelInfo } | { kind: "failed"; message: string } | undefined
  >(undefined);

  const send = useCallback(
    async (content: DraftContent, delivery?: Delivery): Promise<SendOutcome> => {
      const empty =
        typeof content === "string"
          ? content.trim() === ""
          : !content.some((part) => (part.kind === "text" ? part.text.trim() !== "" : true));

      if (empty || sending) return { kind: "ignored" };
      setSending(true);
      setSendError(undefined);

      let message: UserContent;

      try {
        const workspace = client.workspace((await session.info()).workspace);
        message = await uploadDraft(workspace, content);
      } catch (cause) {
        const error = describeSendError(cause);
        setSendError(error);

        return { kind: "failed", error };
      } finally {
        setSending(false);
      }

      const answer = head.send(message, delivery === undefined ? undefined : { delivery }).then(
        (receipt): SendAnswer => ({ kind: "sent", message: receipt.message }),
        (cause: unknown): SendAnswer => ({ kind: "refused", error: describeSendError(cause) }),
      );

      void answer.then((outcome) => {
        if (outcome.kind === "refused") setSendError(outcome.error);
      });

      return { kind: "taken", answer };
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

  const withdraw = async (message: Message["id"]): Promise<void> => {
    await session.receipt(asId<"receipt">(message)).stop();
  };

  const steerNow = async (message: Message["id"], content: UserContent): Promise<void> => {
    await head.revise(message, content, { delivery: "steer" });
  };

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
    withdraw,
    steerNow,
    report,
    selectedModel,
    selectingModel: modelSelection?.kind === "saving",
    modelError: modelSelection?.kind === "failed" ? modelSelection.message : undefined,
    selectModel,
    stop,
  };
}
