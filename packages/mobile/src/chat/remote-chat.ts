import { SdkError } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { RunId } from "@nyte-ai/schema";
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
import { useHost } from "../connection/host-context.tsx";
import {
  healthMessage,
  updatedLabel,
  useChat,
  useHealth,
  useSessions,
} from "../connection/live.ts";
import { uploadDraft, type DraftContent } from "../media/attachments.ts";

export type SendAnswer =
  | { kind: "sent"; message: Message["id"] }
  | { kind: "refused"; error: string };

export type SendOutcome =
  | { kind: "taken"; answer: Promise<SendAnswer> }
  | { kind: "failed"; error: string }
  | { kind: "ignored" };

function describeSendError(cause: unknown, newerHost: boolean): string {
  return cause instanceof Error && !(cause instanceof SdkError)
    ? cause.message
    : describeHostError(cause, newerHost);
}

async function uploadMessage(
  client: Connection,
  session: Session,
  content: DraftContent,
  newerHost: boolean,
): Promise<{ kind: "uploaded"; message: UserContent } | { kind: "failed"; error: string }> {
  try {
    const workspace = client.workspace((await session.info()).workspace);

    return { kind: "uploaded", message: await uploadDraft(workspace, content) };
  } catch (cause) {
    return { kind: "failed", error: describeSendError(cause, newerHost) };
  }
}

async function configureModel(
  head: Head,
  model: ModelInfo,
  newerHost: boolean,
): Promise<string | undefined> {
  try {
    const outcome = await head.configure({ model: model.ref });

    if (outcome.kind === "configured") return undefined;

    return outcome.kind === "unknown-model"
      ? "That model is no longer available on your Mac. Refresh the model list."
      : "Your Mac couldn't apply that model choice.";
  } catch (cause) {
    return describeHostError(cause, newerHost);
  }
}

export function useRemoteChat(client: Connection, sessionId: SessionId, headName?: HeadName) {
  const { newerHost, live } = useHost();
  const session = client.session(sessionId);
  const head = headName === undefined ? session : session.head(headName);

  const chat = useChat(live, client, sessionId, headName);
  const health = useHealth(live);
  const info = useQuery({ queryKey: ["session-info", sessionId], queryFn: () => session.info() });
  const parent = info.data?.parent ?? null;

  const listed = useSessions(live, {
    parents: parent === null ? { kind: "roots" } : { kind: "children", session: parent },
  });

  const state = chat?.view;
  const row = listed?.sessions?.find((candidate) => candidate.id === sessionId);
  const tip = row?.heads.find((entry) => entry.name === head.name)?.tip;

  const [sending, setSending] = useState(false);

  const [sendError, setSendError] = useState<{
    readonly head: HeadName;
    readonly message: string;
  }>();

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

    const upload = await uploadMessage(client, session, content, newerHost);
    setSending(false);

    if (upload.kind === "failed") {
      setSendError({ head: head.name, message: upload.error });

      return upload;
    }

    const answer = head
      .send(upload.message, delivery === undefined ? undefined : { delivery })
      .then(
        (receipt): SendAnswer => ({ kind: "sent", message: receipt.message }),
        (cause: unknown): SendAnswer => ({
          kind: "refused",
          error: describeSendError(cause, newerHost),
        }),
      );

    void answer.then((outcome) => {
      if (outcome.kind === "refused") setSendError({ head: head.name, message: outcome.error });
    });

    return { kind: "taken", answer };
  };

  const selectModel = async (model: ModelInfo): Promise<boolean> => {
    if (modelSelection?.kind === "saving") return false;
    setModelSelection({ kind: "saving", model });
    const failure = await configureModel(head, model, newerHost);
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

  const [stopError, setStopError] = useState<{ readonly run: RunId; readonly message: string }>();
  const execution = state?.execution;
  const running = execution === undefined || execution.kind === "idle" ? undefined : execution.run;

  const stop = async (): Promise<void> => {
    if (running === undefined) return;
    setStopError(undefined);

    try {
      await session.run(running.id).stop();
    } catch (cause) {
      setStopError({ run: running.id, message: describeHostError(cause, newerHost) });
    }
  };

  const configuration: Configuration | null =
    state?.configuration.selected ?? state?.configuration.effective ?? null;

  const selectedModel: ModelRef | undefined =
    modelSelection?.kind === "saving" ? modelSelection.model.ref : configuration?.model;

  return {
    state,
    tip: tip?.kind === "commit" ? tip.id : undefined,
    heads: row?.heads.map((entry) => entry.name) ?? [],
    health: healthMessage(health),
    updated: updatedLabel(chat?.freshness),
    see: (commit: CommitId) => head.see(commit),
    info: info.data,
    reloadInfo: info.refetch,
    configuration,
    sending,
    error:
      (sendError?.head === head.name ? sendError?.message : undefined) ??
      (stopError?.run === running?.id ? stopError?.message : undefined),
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
