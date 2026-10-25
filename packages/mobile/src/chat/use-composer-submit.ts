import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { randomUUID } from "expo-crypto";
import type { CommandInfo, Connection, Delivery, ModelRef, SessionId } from "@nyte-ai/sdk";
import { describeHostError } from "../connection/connection.ts";
import {
  MAX_ATTACHMENTS,
  type DraftContent,
  type DraftPart,
  type StagedImage,
} from "../media/attachments.ts";
import { resolveAttachment } from "../media/annotations.ts";
import { parseCommandLine, type CommandLine } from "./completions.ts";
import type { ComposerTarget, SessionTarget } from "./composer-target.ts";
import { useChatScope } from "./drafts.ts";
import type { ThinkingLevel } from "./thinking.ts";
import {
  readPendingStart,
  recordStart,
  removeStart,
  startText,
  type PendingStart,
} from "./workspace-start.ts";
import { useStartSender, workspaceStorage, type RegistryFolders } from "./workspace-start.tsx";

/** The draft's text, then its photos, then the notes drawn on those photos. */
function buildContent(draft: string, images: readonly StagedImage[]): DraftPart[] {
  const text = draft.trim();

  return [
    ...(text === "" ? [] : [{ kind: "text" as const, text }]),
    ...images.map((image) => resolveAttachment(image).image.image),
    ...images.flatMap((image) => {
      const { note } = resolveAttachment(image);

      return note === undefined ? [] : [{ kind: "text" as const, text: note }];
    }),
  ];
}

/**
 * Sending what the composer holds. In a session a `/command` line runs as a command and anything else is
 * sent, steering or queued behind a running response; a new conversation records a pending start in the
 * chosen folder and sends it in the background. A message leaves the draft once its photos are uploaded
 * and the SDK's journal holds it, so text typed meanwhile survives; a refusal puts it back in front of
 * whatever was typed since. A `/command` the host doesn't know goes out as a message.
 */
export function useComposerSubmit({
  client,
  target,
  folders,
  draft,
  setDraft,
  attachments,
  commands,
  delivery,
  start,
  setStarting,
  onBusyChange,
  reportError,
}: {
  client: Connection;
  target: ComposerTarget;
  folders: RegistryFolders;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  attachments: {
    images: readonly StagedImage[];
    restore: (restored: readonly StagedImage[]) => void;
    withdraw: (submitted: readonly StagedImage[]) => void;
    release: (submitted: readonly StagedImage[]) => void;
  };
  commands: readonly CommandInfo[];
  delivery: Delivery;
  start: { model: ModelRef | undefined; thinking: ThinkingLevel | undefined };
  setStarting: (starting: boolean) => void;
  onBusyChange: ((busy: boolean) => void) | undefined;
  reportError: (message: string | undefined) => void;
}) {
  const scope = useChatScope();
  const startSender = useStartSender();
  const [notice, setNotice] = useState<string>();
  const submissionActive = useRef(false);
  const { images } = attachments;

  const clearSubmitted = (submitted: string, submittedImages: readonly StagedImage[]) => {
    reportError(undefined);
    setDraft((current) => (current === submitted ? "" : current));
    attachments.withdraw(submittedImages);
  };

  const restoreSubmitted = (submitted: string, submittedImages: readonly StagedImage[]) => {
    setDraft((current) => (current.trim() === "" ? submitted : `${submitted}\n\n${current}`));
    attachments.restore(submittedImages);
  };

  const runCommand = async (
    sessionId: SessionId,
    line: CommandLine,
  ): Promise<"ran" | "unknown" | "failed"> => {
    const outcome = await client.session(sessionId).command(line.name, line.argument);

    switch (outcome.kind) {
      case "ran":
        setNotice(outcome.output ?? undefined);

        return "ran";
      case "sent":
        return "ran";
      case "unknown":
        return "unknown";
      case "failed":
        reportError(outcome.message);

        return "failed";
      default: {
        const exhaustive: never = outcome;

        return exhaustive;
      }
    }
  };

  const sendInSession = async (
    session: SessionTarget,
    submitted: string,
    submittedImages: readonly StagedImage[],
    content: DraftContent,
    line: CommandLine | undefined,
  ) => {
    const ran = line === undefined ? "unknown" : await runCommand(session.sessionId, line);

    if (ran === "failed") return;

    if (ran === "ran") {
      clearSubmitted(submitted, submittedImages);
      attachments.release(submittedImages);

      return;
    }

    const outcome = await session.onSend(content, session.running ? delivery : undefined);

    if (outcome.kind !== "taken") return;
    clearSubmitted(submitted, submittedImages);
    void outcome.answer.then((answer) => {
      if (answer.kind === "sent") attachments.release(submittedImages);
      else restoreSubmitted(submitted, submittedImages);
    });
  };

  const startConversation = async (
    submitted: string,
    submittedImages: readonly StagedImage[],
    content: DraftPart[],
  ) => {
    setStarting(true);
    onBusyChange?.(true);
    const folder = folders.kind === "ready" ? folders.selected : undefined;

    if (folder === undefined) {
      reportError(
        folders.kind === "ready" ? "Choose a folder first." : "Folders are still loading.",
      );

      return;
    }

    if (readPendingStart(workspaceStorage, scope) !== undefined) {
      reportError("Finish the waiting message first.");

      return;
    }

    const typed = submitted.trim().split("\n")[0]?.slice(0, 48) ?? "";

    const recorded = recordStart(workspaceStorage, scope, {
      requestId: randomUUID(),
      workspace: folder.id,
      name: typed === "" ? "New conversation" : typed,
      content,
      model: start.model,
      thinking: start.thinking,
    });

    if (recorded.kind === "waiting") {
      reportError("Finish the waiting message first.");

      return;
    }

    clearSubmitted(submitted, submittedImages);
    attachments.release(submittedImages);
    void startSender.send(recorded.pending.input, true).then((failure) => {
      if (failure !== undefined) reportError(failure);
    });
  };

  const submit = () => {
    if (submissionActive.current) return;
    submissionActive.current = true;
    const submitted = draft;
    const submittedImages = images;
    const content = buildContent(draft, images);
    const line = images.length === 0 ? parseCommandLine(draft, commands) : undefined;
    setNotice(undefined);
    reportError(undefined);

    const submission =
      target.kind === "session"
        ? sendInSession(target, submitted, submittedImages, content, line)
        : startConversation(submitted, submittedImages, content);

    void submission
      .catch((cause: unknown) => reportError(describeHostError(cause)))
      .finally(() => {
        submissionActive.current = false;
        setStarting(false);

        if (target.kind === "new") onBusyChange?.(false);
      });
  };

  const editStart = (pending: PendingStart) => {
    const restored = pending.input.content.flatMap((part): StagedImage[] =>
      part.kind === "image"
        ? [{ id: randomUUID(), uri: `data:${part.mime};base64,${part.data}`, image: part }]
        : [],
    );

    if (images.length + restored.length > MAX_ATTACHMENTS) {
      reportError("Remove a photo first.");

      return;
    }

    const text = startText(pending.input);
    setDraft((current) => (current.trim() === "" ? text : `${text}\n\n${current}`));
    attachments.restore(restored);
    removeStart(workspaceStorage, scope, pending.input.requestId);
    reportError(undefined);
  };

  return { notice, submit, editStart };
}
