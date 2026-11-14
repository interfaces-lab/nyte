import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { ReactElement, ReactNode } from "react";
import type { Delivery, HeldMessage, MessageId, SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { PLANNING_LABEL, runMark, taskLabel } from "@nyte-ai/plugin/client/presentation";
import type { RunStatus, UserMessage } from "@nyte-ai/plugin/client/presentation";
import { errorMessage } from "../../contract/errors.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { useCatalog } from "../../data/catalog.ts";
import { useHostHealth } from "../../data/host.ts";
import { useMentionFiles } from "../../data/files.ts";
import { SIDECHAT_COMMAND, usePluginCatalog } from "../../data/plugins.ts";
import { sessionActions } from "../../data/session-rows.ts";
import { useSessionActivity, useSessionChoice } from "../../data/sessions.ts";
import { connected, connection } from "../../data/connection.ts";
import { chatStore, resendMessage, stopChat, useChatStopping } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { nyte } from "../../contract/nyte.ts";
import type { ComposerViewState } from "../../panes/session-view-state.ts";
import { usePaneViewStateStore } from "../../panes/pane-context.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { ComposerFrame } from "./composer-frame.tsx";
import type { ComposerSurface } from "./composer-frame.tsx";
import { sessionModel } from "./model-picker-state.ts";
import { SessionModelChip } from "./composer-model-chip.tsx";
import { ComposerQueue } from "./composer-queue.tsx";
import type { PendingRowAction } from "./composer-queue.tsx";
import { composerSource } from "./composer-suggestions.tsx";
import { bindComposerFileDrop } from "../../references/composer-file-drop.ts";
import { attachComposerFiles } from "./composer-files.ts";
import type { ComposerFile } from "../../references/composer-file-drop.ts";
import { ComposerFooter } from "./composer-footer.tsx";
import { loadedPrompts, readPrompts, recallStep } from "./composer-history.ts";
import type { PromptHistory, RecallDirection } from "./composer-history.ts";
import { deliveryChoices, nextToSteer } from "./composer-keys.ts";
import { deliver, deliverEdit, draftCommands } from "./composer-send.ts";
import { planSubmission } from "./composer-plan.ts";
import {
  foldEdit,
  leftDraft,
  lostEdit,
  openedEdit,
  refusedDraft,
  restoredDraft,
  shownDraft,
  typedDraft,
  updateShown,
} from "./composer-draft.ts";
import type { ComposerNotice, QueuedEdit, SessionDraft } from "./composer-draft.ts";
import { preferences, useSetting } from "../../preferences/index.ts";
import { TaskMark } from "../../components/task-mark.tsx";
import { workbenchViewKey } from "../../workbench/paths.ts";
import { workbench } from "../../workbench/store.ts";
import { windowTabs } from "../../tabs/window-tabs.ts";
import { composerStyles } from "./composer.stylex.ts";
import { markerStyles } from "../transcript/activity.stylex.ts";
import {
  TranscriptButton,
  useTranscriptControls,
  useTranscriptDock,
} from "../transcript/transcript.tsx";
import { QuestionDockContext, useQuestionDock } from "../trays/questions-state.ts";
import { useCommitCount } from "../../lib/work-counts.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useChatFolder } from "../chat-folder.ts";

const FOLLOW_UP_PLACEHOLDER = "Add a follow-up";

function messageReceipt(sessionId: SessionId, message: UserMessage) {
  return connection().session(sessionId).receipt(asId<"receipt">(message.id));
}

const EDIT_ENDED_NOTICES = {
  sent: "That message was already sent.",
  missing: "That message is no longer queued.",
  lapsed: "Couldn't keep the message on hold.",
} satisfies Record<Awaited<HeldMessage["lost"]>["kind"], string>;

interface EditHold {
  held: HeldMessage | undefined;
}

/**
 * The chat's draft, its queued edit and its notice live in the window's draft store and change only
 * through it, so a send that settles after this composer closed still lands where the chat's next
 * composer reads it. `draft` is the store's value as the subscription last handed it over: a state
 * update shares a keystroke's commit with the editor's own updates, where `useSyncExternalStore`
 * would add a second commit per key. A notice other than a refusal is dropped once the composer is
 * gone, as it was when the composer held it.
 */
export function Composer({
  sessionId,
  status,
  pending,
  unsent,
  expired,
  inputRef,
  fileDropRoot,
  backgroundWork,
  floatingMount = null,
  active = false,
  steer,
  surface = "follow-up",
}: {
  sessionId: SessionId;
  status: RunStatus;
  pending: readonly UserMessage[];
  unsent: readonly UserMessage[];
  expired: readonly MessageId[];
  inputRef?: (element: ComposerEditorHandle | null) => void;
  fileDropRoot?: HTMLElement | null;
  backgroundWork?: {
    readonly content: ReactNode;
    readonly onEscape: () => boolean;
  };
  floatingMount?: HTMLDivElement | null;
  active?: boolean;
  steer?: { readonly session: SessionId; readonly title: string };
  surface?: Exclude<ComposerSurface, "new-chat">;
}): ReactElement {
  useCommitCount("render:composer");
  const runningMessage = useSetting(preferences.runningMessage);
  const catalog = useCatalog(sessionId);
  const choice = useSessionChoice(sessionId);

  const steers = sessionModel(catalog.data, choice).steers;

  const runningMessagePreference = steers ? runningMessage : "queue";
  const attachTranscriptDock = useTranscriptDock();
  const transcript = useTranscriptControls();
  const viewStore = usePaneViewStateStore();

  const [draft, setDraft] = useState(() => viewStore.readSession(sessionId).draft);

  const shownView = shownDraft(draft);
  const attachments = shownView.attachments;
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const feedback = draft.notice;
  const [rowActions, setRowActions] = useState<ReadonlyMap<string, PendingRowAction>>(new Map());
  const liveRun = "run" in status ? status.run : undefined;
  const target = draft.edit;
  const [savingEdit, setSavingEdit] = useState(false);
  const folder = useChatFolder();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const mac = nyte.platform === "darwin";
  const health = useHostHealth();

  const asked = useChatStopping(sessionId) === "asked";
  const stopping = (status.kind === "working" && status.stopping) || asked;

  const staleSince = useWatchSelect(chatStore(sessionId), (state) =>
    state.value?.freshness.kind === "stale" ? state.value.freshness.since : undefined,
  );
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const questions = useQuestionDock(sessionId);
  const pluginCatalog = usePluginCatalog(sessionId);
  const floating = floatingMount !== null;

  const [portalHost] = useState(() => {
    const element = document.createElement("div");
    element.style.display = "contents";

    return element;
  });

  const inlineSlot = useRef<HTMLDivElement | null>(null);
  const focusAfterMove = useRef(false);
  const cwd = folder?.path;
  const activity = useSessionActivity(floating ? sessionId : undefined, cwd);

  const attachInlineSlot = (slot: HTMLDivElement | null): void => {
    inlineSlot.current = slot;

    if (slot === null) {
      portalHost.remove();

      return;
    }

    slot.append(portalHost);
  };

  // oxlint-disable-next-line nyte-code/no-direct-effect -- moves the portal host between DOM mounts before paint
  useLayoutEffect(() => {
    const destination = floatingMount ?? inlineSlot.current;

    if (destination === null || portalHost.parentElement === destination) return;
    destination.append(portalHost);

    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    editorRef.current?.focus({ preventScroll: true });
  }, [floatingMount, portalHost]);

  const suggestionCatalog = composerSource(
    surface === "side-chat" && pluginCatalog.data !== undefined
      ? {
          ...pluginCatalog.data,
          commands: pluginCatalog.data.commands.filter(
            (command) => command.name !== SIDECHAT_COMMAND.name,
          ),
        }
      : pluginCatalog.data,
    pluginCatalog.isError,
  );

  const mentions = useMentionFiles(folder, true);
  const mentionFiles = composerSource(mentions.data, mentions.isError);
  const pendingRecall = useRef<symbol | undefined>(undefined);

  const storedDraft = (): SessionDraft => viewStore.readSession(sessionId).draft;

  const updateDraft = (update: (current: SessionDraft) => SessionDraft): void => {
    const before = shownDraft(storedDraft()).draft;

    if (shownDraft(viewStore.updateDraft(sessionId, update)).draft !== before)
      pendingRecall.current = undefined;
  };

  const updateViewState = (update: (current: ComposerViewState) => ComposerViewState): void =>
    updateDraft((current) => updateShown(current, update));

  const shown = useRef(false);

  const setFeedback = (notice: ComposerNotice | null): void => {
    if (!shown.current) return;
    updateDraft((current) => ({ ...current, notice }));
  };

  const recalled = useRef<
    | {
        readonly position: number;
        readonly draft: ComposerViewState;
        readonly history: PromptHistory;
      }
    | undefined
  >(undefined);

  const step = (history: PromptHistory, direction: RecallDirection): boolean => {
    pendingRecall.current = undefined;
    const position = recallStep(history.prompts.length, recalled.current?.position, direction);

    if (position === recalled.current?.position) return false;
    const saved = recalled.current?.draft ?? shownDraft(storedDraft());
    const prompt = position === undefined ? undefined : history.prompts[position];
    recalled.current = position === undefined ? undefined : { position, draft: saved, history };
    updateViewState((current) =>
      prompt === undefined
        ? {
            ...current,
            draft: saved.draft,
            selectionStart: saved.selectionStart,
            selectionEnd: saved.selectionEnd,
          }
        : { ...current, draft: prompt, selectionStart: prompt.length, selectionEnd: prompt.length },
    );

    return true;
  };

  const recall = (direction: RecallDirection): boolean => {
    const walk = recalled.current;
    const history = walk?.history ?? loadedPrompts(chatStore(sessionId).value);
    const older = walk === undefined ? 0 : walk.position + 1;

    if (direction === "newer" || older < history.prompts.length || history.before === null)
      return step(history, direction);

    if (pendingRecall.current !== undefined) return true;
    const read = Symbol("recall");
    pendingRecall.current = read;
    void readPrompts(connection().session(sessionId), history, older + 1).then(
      (more) => {
        if (pendingRecall.current === read) step(more, direction);
      },
      (cause: unknown) => {
        if (pendingRecall.current === read) pendingRecall.current = undefined;
        setFeedback({
          kind: "error",
          message: `Couldn't read earlier prompts: ${errorMessage(cause)}`,
          restore: null,
        });
      },
    );

    return true;
  };

  const editHold = useRef<EditHold | undefined>(undefined);
  const removedSends = useRef(new Set<string>());

  const takeHold = (): HeldMessage | undefined => {
    const held = editHold.current?.held;
    editHold.current = undefined;

    return held;
  };

  const releaseHold = (): void => {
    void takeHold()?.release();
  };

  const endEdit = (update: (current: SessionDraft) => SessionDraft): void => {
    releaseHold();
    setAttachmentError(undefined);
    updateDraft(update);
  };

  const leaveEdit = (message: MessageId, notice: string): void => {
    if (storedDraft().edit?.message.id !== message) return;
    endEdit(lostEdit);
    setFeedback({ kind: "error", message: notice, restore: null });
  };

  const startHold = (message: MessageId): void => {
    releaseHold();

    if (!shown.current) return;
    const hold: EditHold = { held: undefined };
    editHold.current = hold;

    const lose = (notice: string): void => {
      if (editHold.current !== hold) return;
      editHold.current = undefined;
      leaveEdit(message, notice);
    };

    connection()
      .session(sessionId)
      .hold(message)
      .then(
        (outcome) => {
          if (outcome.kind !== "held") {
            lose(EDIT_ENDED_NOTICES[outcome.kind]);

            return;
          }

          if (editHold.current !== hold) {
            void outcome.release();

            return;
          }

          hold.held = outcome;
          void outcome.lost.then((lost) => lose(EDIT_ENDED_NOTICES[lost.kind]));
        },
        (cause: unknown) => lose(`Couldn't hold the message: ${errorMessage(cause)}`),
      );
  };

  const resumeHold = useEffectEvent(() => {
    if (target !== null && !savingEdit) startHold(target.message.id);
  });

  useMountEffect(() => {
    shown.current = true;
    const show = (): void => setDraft(viewStore.readSession(sessionId).draft);
    const leave = viewStore.subscribeDraft(sessionId, show);
    show();
    resumeHold();

    return () => {
      shown.current = false;
      pendingRecall.current = undefined;
      releaseHold();
      leave();
      viewStore.updateDraft(sessionId, foldEdit);
    };
  });

  const attachInput = (handle: ComposerEditorHandle | null) => {
    editorRef.current = handle;
    inputRef?.(handle);
  };

  const addFiles = async (
    files: readonly ComposerFile[],
    signal?: AbortSignal,
  ): Promise<string | undefined> => {
    if (savingEdit) return "Finish editing the message, then attach the image again.";
    setAttachmentReads((count) => count + 1);

    return attachComposerFiles({ files, editor: editorRef.current })
      .then((result) => {
        signal?.throwIfAborted();

        if (result.attachments.length > 0) {
          updateViewState((current) => ({
            ...current,
            attachments: [...current.attachments, ...result.attachments],
          }));
        }

        setAttachmentError(result.error);

        return result.error;
      })
      .finally(() => setAttachmentReads((count) => count - 1));
  };

  const setRowAction = (change: string, action: PendingRowAction): void => {
    setRowActions((current) => {
      const shown = new Set<string>(pending.map((item) => item.id));
      const next = new Map([...current].filter(([held]) => shown.has(held)));
      next.set(change, action);

      return next;
    });
  };

  const send = async (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): Promise<void> => {
    if (attachmentReads !== 0) return;
    pendingRecall.current = undefined;
    const sentAttachments = attachments;
    const submittingTab = windowTabs.paneTabId();
    const receipt = asId<"receipt">(crypto.randomUUID());

    const plan = planSubmission({
      submission,
      attachments: sentAttachments,
      commands: await draftCommands(steer?.session ?? sessionId, submission.text),
      delivery,
    });

    if (plan.kind === "empty") return;

    if (plan.kind === "kept") {
      setFeedback({ kind: "error", message: plan.message, restore: null });

      return;
    }

    const session = (await connected()).session(steer?.session ?? sessionId);
    windowTabs.dispatch({ kind: "keep-tab", tabId: submittingTab });
    recalled.current = undefined;
    updateDraft((current) => leftDraft(current, document, sentAttachments));
    setAttachmentError(undefined);
    setFeedback(null);
    const outcome = await deliver(session, plan, receipt);

    switch (outcome.kind) {
      case "refused":
        if (removedSends.current.delete(receipt)) return;
        updateDraft((current) =>
          refusedDraft(current, outcome.message, {
            text: document.text,
            attachments: sentAttachments,
          }),
        );

        return;
      case "sent":
        if (outcome.note !== undefined)
          setFeedback({ kind: "command", message: outcome.note, restore: null });
        sessionActions.restore(steer?.session ?? sessionId);

        if (steer === undefined) transcript.end();

        return;
      default: {
        const _exhaustive: never = outcome;

        return _exhaustive;
      }
    }
  };

  const saveEdit = async (
    edit: QueuedEdit,
    submission: ComposerSubmission,
    delivery: Delivery,
  ): Promise<void> => {
    if (attachmentReads !== 0) return;
    const session = connection().session(sessionId);
    const held = takeHold();
    setSavingEdit(true);

    const saved = await deliverEdit({
      sessionId,
      submission,
      attachments,
      delivery,
      message: edit.message,
      revise: (content, options) =>
        held !== undefined
          ? held.save(content, options)
          : session.revise(edit.message.id, content, options),
    });

    if (held !== undefined) await held.release();

    flushSync(() => {
      setSavingEdit(false);

      switch (saved.kind) {
        case "empty":
          startHold(edit.message.id);

          return;
        case "kept":
        case "refused":
          startHold(edit.message.id);
          setFeedback({ kind: "error", message: saved.message, restore: null });

          return;
        case "revised":
          endEdit((current) =>
            current.edit?.message.id === edit.message.id ? { ...current, edit: null } : current,
          );

          return;
        case "sent":
        case "missing":
          leaveEdit(edit.message.id, EDIT_ENDED_NOTICES[saved.kind]);

          return;
        default: {
          const _exhaustive: never = saved;

          return _exhaustive;
        }
      }
    });
    editorRef.current?.focus({ preventScroll: true });

    if (saved.kind !== "revised") return;
    sessionActions.restore(sessionId);
    transcript.end();
  };

  const abort = (): void => {
    if (liveRun === undefined || stopping) return;
    stopChat(sessionId).catch((cause: unknown) =>
      setFeedback({
        kind: "error",
        message: `Couldn't stop the response: ${errorMessage(cause)}`,
        restore: null,
      }),
    );
  };

  const cancelPending = (item: UserMessage): void => {
    setRowAction(item.id, { kind: "cancelling" });
    messageReceipt(sessionId, item)
      .stop()
      .catch((cause: unknown) =>
        setRowAction(item.id, {
          kind: "failed",
          message: `Couldn't cancel: ${errorMessage(cause)}`,
        }),
      );
  };

  const steerPending = (item: UserMessage): void => {
    setRowAction(item.id, { kind: "sending" });
    connection()
      .session(sessionId)
      .revise(item.id, item.content, { delivery: deliveryChoices.steer })
      .then(
        (outcome) => {
          switch (outcome.kind) {
            case "revised":
              setRowActions(
                (current) => new Map([...current].filter(([shown]) => shown !== item.id)),
              );

              return;
            case "sent":
            case "missing":
              return;
            default: {
              const _exhaustive: never = outcome;

              return _exhaustive;
            }
          }
        },
        (cause: unknown) =>
          setRowAction(item.id, {
            kind: "failed",
            message: `Couldn't steer: ${errorMessage(cause)}`,
          }),
      );
  };

  const nextQueued = nextToSteer(pending);
  const nextQueuedAction = nextQueued === undefined ? undefined : rowActions.get(nextQueued.id);

  const nextIdleQueued =
    nextQueuedAction === undefined || nextQueuedAction.kind === "failed" ? nextQueued : undefined;

  const emptyDraft = shownView.draft === "" && attachments.length === 0;

  const emptyEnterSteers =
    questions === undefined && target === null && emptyDraft && nextIdleQueued !== undefined;

  const canBeginEdit = questions === undefined && target === null;

  const queuedEditReason =
    questions === undefined && target !== null
      ? "Finish editing the queued message first."
      : undefined;

  const beginEdit = (item: UserMessage): void => {
    if (!canBeginEdit || item.source.kind === "action") return;
    updateDraft((current) => openedEdit(current, item));
    startHold(item.id);
    setAttachmentError(undefined);
    editorRef.current?.focus();
  };

  const removeOutboxRow = (row: UserMessage): void => {
    removedSends.current.add(row.id);
    messageReceipt(sessionId, row)
      .stop()
      .catch((cause: unknown) => {
        setFeedback({
          kind: "error",
          message: `Couldn't remove the message: ${errorMessage(cause)}`,
          restore: null,
        });
      });
  };

  const resendOutboxRow = (row: UserMessage): void => {
    resendMessage(sessionId, row.id).catch((cause: unknown) => {
      setFeedback({
        kind: "error",
        message: `Couldn't send the message: ${errorMessage(cause)}`,
        restore: null,
      });
    });
  };

  const returnToEditor = (): void => editorRef.current?.focus({ preventScroll: true });

  const dock = (
    <div ref={attachTranscriptDock} {...props(composerStyles.dock)}>
      <div
        data-composer-region
        {...props(
          composerStyles.region,
          floating && composerStyles.regionFloating,
          surface === "side-chat" && composerStyles.regionSideChat,
        )}
      >
        <div {...props(composerStyles.inputStack)}>
          <div {...props(composerStyles.preComposerOverlay)}>
            <div {...props(composerStyles.preComposerStack)}>
              {feedback !== null && (
                <div
                  role={feedback.kind === "error" ? "alert" : "status"}
                  {...props(composerStyles.queued)}
                >
                  <Icon
                    name={
                      feedback.kind === "error"
                        ? "bubble-question"
                        : feedback.kind === "command"
                          ? "command"
                          : "sparkle"
                    }
                  />
                  <span {...props(composerStyles.queuedText)}>{feedback.message}</span>
                  {feedback.restore !== null && (
                    <Button variant="text" onClick={() => updateDraft(restoredDraft)}>
                      Restore Draft
                    </Button>
                  )}
                  <Button
                    iconOnly
                    icon="x"
                    aria-label="Dismiss notification"
                    onClick={() => setFeedback(null)}
                  />
                </div>
              )}
              {health !== undefined && health.kind !== "open" && (
                <div
                  role={health.kind === "blocked" ? "alert" : "status"}
                  {...props(composerStyles.queued)}
                >
                  <Icon name={health.kind === "blocked" ? "warning" : "refresh"} />
                  <span {...props(composerStyles.queuedText)}>
                    {health.kind === "blocked"
                      ? "Disconnected from the host."
                      : "Reconnecting to the host…"}
                  </span>
                </div>
              )}
              {staleSince !== undefined && (
                <div role="status" {...props(composerStyles.queued)}>
                  <Icon name="clock" />
                  <span {...props(composerStyles.queuedText)}>
                    {`Chat last updated at ${new Date(staleSince).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}.`}
                  </span>
                </div>
              )}
              <ComposerQueue
                pending={pending}
                unsent={unsent}
                expired={expired}
                rowActions={rowActions}
                editingId={target === null ? undefined : target.message.id}
                canEdit={canBeginEdit}
                editBlocked={queuedEditReason}
                enterSteers={emptyEnterSteers}
                mac={mac}
                onEdit={beginEdit}
                onSteer={steerPending}
                onCancel={cancelPending}
                onRemoveUnsent={removeOutboxRow}
                onResend={resendOutboxRow}
                onEditBlocked={(message) => setFeedback({ kind: "status", message, restore: null })}
                onReturn={returnToEditor}
              />
            </div>
            <div {...props(composerStyles.preComposerPills)}>
              <QuestionDockContext value={questions}>{backgroundWork?.content}</QuestionDockContext>
              {floating ? (
                <>
                  {liveRun !== undefined && (
                    <span {...props(text.base, composerStyles.floatingStatus)}>
                      <TaskMark state={runMark(status)} />
                      <span {...props(composerStyles.floatingStatusText, markerStyles.shimmer)}>
                        {status.kind === "waiting-for-approval"
                          ? taskLabel(runMark(status))
                          : (activity ?? PLANNING_LABEL)}
                      </span>
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    pill
                    onClick={() => {
                      focusAfterMove.current = true;
                      workbench.dispatch(workbenchViewKey(cwd), { kind: "show-chat" });
                    }}
                  >
                    Show Chat
                  </Button>
                </>
              ) : (
                <TranscriptButton />
              )}
            </div>
          </div>
          <ComposerFrame
            surface={surface}
            document={
              questions?.document ?? {
                text: shownView.draft,
                selectionStart: shownView.selectionStart,
                selectionEnd: shownView.selectionEnd,
              }
            }
            onDocumentChange={(document) => {
              if (questions !== undefined) {
                questions.changeDocument(document);

                return;
              }

              if (document.text !== shownDraft(storedDraft()).draft) recalled.current = undefined;
              updateDraft((current) => typedDraft(current, document));
            }}
            onSubmit={
              questions === undefined
                ? target !== null
                  ? (submission, delivery) => saveEdit(target, submission, delivery)
                  : send
                : async (_submission, _delivery, document) => {
                    await questions.advance(document);
                  }
            }
            placeholder={steer === undefined ? FOLLOW_UP_PLACEHOLDER : `Message ${steer.title}`}
            floating={floating}
            disabled={questions?.pending === true || questions?.settled === true || savingEdit}
            busy={liveRun !== undefined}
            runningMessagePreference={runningMessagePreference}
            answering={questions !== undefined}
            stopping={stopping}
            onAbort={abort}
            onDismissTray={
              questions === undefined
                ? backgroundWork?.onEscape
                : () => {
                    void questions.dismiss();

                    return true;
                  }
            }
            onSteerQueued={
              questions === undefined && nextIdleQueued !== undefined
                ? () => steerPending(nextIdleQueued)
                : undefined
            }
            onRecall={questions === undefined && target === null ? recall : undefined}
            completeCommand={(name, prefix) =>
              connection().session(sessionId).completeCommand(name, prefix)
            }
            suggestionCatalog={
              questions === undefined
                ? suggestionCatalog
                : { status: "ready", data: { commands: [], skills: [] } }
            }
            mentionFiles={questions === undefined ? mentionFiles : { status: "ready", data: [] }}
            hasConversationContext
            attachments={questions === undefined ? attachments : []}
            attachmentBusy={questions === undefined && attachmentReads !== 0}
            attachmentError={questions === undefined ? attachmentError : undefined}
            onFilesSelected={questions === undefined ? addFiles : undefined}
            onAttachmentRemove={(id) => {
              updateViewState((current) => ({
                ...current,
                attachments: current.attachments.filter((attachment) => attachment.id !== id),
              }));
              setAttachmentError(undefined);
            }}
            model={
              questions === undefined ? (
                <SessionModelChip
                  sessionId={sessionId}
                  open={modelPickerOpen}
                  onOpenChange={setModelPickerOpen}
                />
              ) : undefined
            }
            inputRef={attachInput}
            editing={
              questions !== undefined || target === null
                ? undefined
                : {
                    kind: "queued",
                    delivery: target.message.delivery,
                    onCancel: () => endEdit((current) => ({ ...current, edit: null })),
                  }
            }
          />
          {!floating && surface === "follow-up" && (
            <ComposerFooter sessionId={sessionId} active={active} />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div ref={attachInlineSlot} {...props(composerStyles.portalSlot)} />
      {createPortal(dock, portalHost)}
      {fileDropRoot !== undefined && fileDropRoot !== null && (
        <FileDrop element={fileDropRoot} onFiles={(files) => void addFiles(files)} />
      )}
    </>
  );
}

function FileDrop({
  element,
  onFiles,
}: {
  readonly element: HTMLElement;
  readonly onFiles: (files: readonly ComposerFile[]) => void;
}): null {
  const drop = useEffectEvent(onFiles);

  useMountEffect(() => bindComposerFileDrop({ element, onFiles: drop }));

  return null;
}
