import { SdkError } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  Configuration,
  Connection,
  Delivery,
  Head,
  HeadName,
  Message,
  ModelInfo,
  ModelRef,
  PartId,
  Session,
  SessionId,
  UserContent,
} from "@nyte-ai/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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

/** The draft as a message the host can take, with its photos uploaded, or why it couldn't be. */
async function uploadMessage(
  client: Connection,
  session: Session,
  content: DraftContent,
): Promise<{ kind: "uploaded"; message: UserContent } | { kind: "failed"; error: string }> {
  try {
    const workspace = client.workspace((await session.info()).workspace);

    return { kind: "uploaded", message: await uploadDraft(workspace, content) };
  } catch (cause) {
    return { kind: "failed", error: describeSendError(cause) };
  }
}

/** What kept the head from switching to `model`, or `undefined` once it switched. */
async function configureModel(head: Head, model: ModelInfo): Promise<string | undefined> {
  try {
    const outcome = await head.configure({ model: model.ref });

    if (outcome.kind === "configured") return undefined;

    return outcome.kind === "unknown-model"
      ? "That model is no longer available on your Mac. Refresh the model list."
      : "Your Mac couldn't apply that model choice.";
  } catch (cause) {
    return describeHostError(cause);
  }
}

/**
 * A session's live view and what the conversation does to it. `sending` covers only the photo upload;
 * the SDK's journal serializes the sends after it. `withdraw` drops a message the host hasn't started
 * on, and `steerNow` moves a queued one into the running response.
 */
export function useRemoteChat(client: Connection, sessionId: SessionId, headName?: HeadName) {
  const session = client.session(sessionId);
  const head = headName === undefined ? session : session.head(headName);

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

  const send = async (content: DraftContent, delivery?: Delivery): Promise<SendOutcome> => {
    const empty =
      typeof content === "string"
        ? content.trim() === ""
        : !content.some((part) => (part.kind === "text" ? part.text.trim() !== "" : true));

    if (empty || sending) return { kind: "ignored" };
    setSending(true);
    setSendError(undefined);

    const upload = await uploadMessage(client, session, content);
    setSending(false);

    if (upload.kind === "failed") {
      setSendError(upload.error);

      return upload;
    }

    const answer = head
      .send(upload.message, delivery === undefined ? undefined : { delivery })
      .then(
        (receipt): SendAnswer => ({ kind: "sent", message: receipt.message }),
        (cause: unknown): SendAnswer => ({ kind: "refused", error: describeSendError(cause) }),
      );

    void answer.then((outcome) => {
      if (outcome.kind === "refused") setSendError(outcome.error);
    });

    return { kind: "taken", answer };
  };

  const selectModel = async (model: ModelInfo): Promise<boolean> => {
    if (modelSelection?.kind === "saving") return false;
    setModelSelection({ kind: "saving", model });
    const failure = await configureModel(head, model);
    setModelSelection(failure === undefined ? undefined : { kind: "failed", message: failure });

    return failure === undefined;
  };

  const withdraw = async (message: Message["id"]): Promise<void> => {
    await session.receipt(asId<"receipt">(message)).stop();
  };

  const steerNow = async (message: Message["id"], content: UserContent): Promise<void> => {
    await head.revise(message, content, { delivery: "steer" });
  };

  const report = (part: PartId, message: string): void => {
    void session
      .part(part)
      .act("report", { message })
      .catch(() => undefined);
  };

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
