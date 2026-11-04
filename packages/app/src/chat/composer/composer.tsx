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
import { usePluginCatalog } from "../../data/plugins.ts";
import { sessionActions } from "../../data/session-rows.ts";
import { useSessionActivity, useSessionChoice } from "../../data/sessions.ts";
import { connection } from "../../data/connection.ts";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { nyte } from "../../contract/nyte.ts";
import { DEFAULT_COMPOSER_VIEW_STATE } from "../../panes/session-view-state.ts";
import type { ComposerViewState } from "../../panes/session-view-state.ts";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { ComposerFrame } from "./composer-frame.tsx";
import { selectedModelOption } from "./model-picker-state.ts";
import { SessionModelChip } from "./composer-model-chip.tsx";
import { ComposerQueue } from "./composer-queue.tsx";
import type { PendingRowAction } from "./composer-queue.tsx";
import { composerSource } from "./composer-suggestions.tsx";
import { bindComposerFileDrop } from "../../references/composer-file-drop.ts";
import { attachComposerFiles } from "./composer-files.ts";
import type { ComposerImageAttachment } from "../../panes/session-view-state.ts";
import { ComposerFooter } from "./composer-footer.tsx";
import { loadedPrompts, readPrompts, recallStep } from "./composer-history.ts";
import type { PromptHistory, RecallDirection } from "./composer-history.ts";
import { deliveryChoices, nextToSteer } from "./composer-keys.ts";
import { deliverEdit, deliverSubmission } from "./composer-send.ts";
import { contentDraftText } from "../../references/message-references.ts";
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

interface ComposerFeedback {
  readonly kind: "status" | "command" | "error";
  readonly message: string;
  readonly restore?: () => void;
}

type ComposerTarget =
  | { readonly kind: "new" }
  | { readonly kind: "queued"; readonly message: UserMessage; readonly stash: ComposerViewState };

function messageReceipt(sessionId: SessionId, message: UserMessage) {
  return connection().session(sessionId).receipt(asId<"receipt">(message.id));
}

function draftWith(
  view: ComposerViewState,
  front: { readonly text: string; readonly attachments: readonly ComposerImageAttachment[] },
): ComposerViewState {
  const joined = view.draft === "" ? front.text : `${front.text}\n${view.draft}`;

  return {
    ...view,
    draft: joined,
    attachments: [...front.attachments, ...view.attachments],
    selectionStart: joined.length,
    selectionEnd: joined.length,
  };
}

const EDIT_ENDED_NOTICES = {
  sent: "That message was already sent.",
  missing: "That message is no longer queued.",
  lapsed: "Couldn't keep the message on hold.",
} satisfies Record<Awaited<HeldMessage["lost"]>["kind"], string>;

/**
 * A queued message held on the host while it is edited. `held` stays unset until the host grants
 * the hold; the object's identity marks the current attempt. Hiding the session (Activity) or
 * closing it lets the hold go, and showing it again takes it back.
 */
interface EditHold {
  held: HeldMessage | undefined;
}

export function Composer({
  sessionId,
  status,
  pending,
  unsent,
  initialViewState = DEFAULT_COMPOSER_VIEW_STATE,
  onViewStateChange,
  inputRef,
  fileDropRoot,
  backgroundWork,
  floatingMount = null,
  active = false,
  steer,
}: {
  sessionId: SessionId;
  status: RunStatus;
  pending: readonly UserMessage[];
  unsent: readonly UserMessage[];
  initialViewState?: ComposerViewState;
  onViewStateChange?: (state: ComposerViewState) => void;
  inputRef?: (element: ComposerEditorHandle | null) => void;
  fileDropRoot?: HTMLElement | null;
  backgroundWork?: {
    readonly content: ReactNode;
    readonly onEscape: () => boolean;
  };
  floatingMount?: HTMLDivElement | null;
  /** Whether this composer's pane is the active one, so the footer's menus take their shortcuts. */
  active?: boolean;
  /** The thread a message goes to instead of this chat, while the agents tray previews it. */
  steer?: { readonly session: SessionId; readonly title: string };
}): ReactElement {
  useCommitCount("render:composer");
  const runningMessage = useSetting(preferences.runningMessage);
  const catalog = useCatalog(sessionId);
  const choice = useSessionChoice(sessionId);

  const selectedModel = selectedModelOption(catalog.data?.models ?? [], choice?.model);
  const steers = selectedModel?.option.capabilities.steer !== false;

  const runningMessagePreference = steers ? runningMessage : "queue";
  const attachTranscriptDock = useTranscriptDock();
  const transcript = useTranscriptControls();
  const [currentViewState, setCurrentViewState] = useState(initialViewState);
  const attachments = currentViewState.attachments;
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [feedback, setFeedback] = useState<ComposerFeedback>();
  const [rowActions, setRowActions] = useState<ReadonlyMap<string, PendingRowAction>>(new Map());
  const liveRun = "run" in status ? status.run : undefined;
  const stopping = status.kind === "working" && status.stopping;
  const [target, setTarget] = useState<ComposerTarget>({ kind: "new" });
  const [savingEdit, setSavingEdit] = useState(false);
  const folder = useChatFolder();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const mac = nyte.platform === "darwin";
  const health = useHostHealth();

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

  const suggestionCatalog = composerSource(pluginCatalog.data, pluginCatalog.isError);

  const workspaceFiles = useMentionFiles(folder, true);
  const mentionFiles = composerSource(workspaceFiles.data, workspaceFiles.isError);
  const latestViewState = useRef(currentViewState);
  const latestTarget = useRef(target);

  const pendingRecall = useRef<symbol | undefined>(undefined);

  const updateViewState = (update: (current: ComposerViewState) => ComposerViewState): void => {
    const next = update(latestViewState.current);

    if (next.draft !== latestViewState.current.draft) pendingRecall.current = undefined;
    latestViewState.current = next;
    setCurrentViewState(next);
    const editing = latestTarget.current;
    onViewStateChange?.(
      editing.kind === "queued"
        ? draftWith(editing.stash, { text: next.draft, attachments: next.attachments })
        : next,
    );
  };

  const retarget = (next: ComposerTarget): void => {
    latestTarget.current = next;
    setTarget(next);
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
    const draft = recalled.current?.draft ?? latestViewState.current;
    const prompt = position === undefined ? undefined : history.prompts[position];
    recalled.current = position === undefined ? undefined : { position, draft, history };
    updateViewState((current) =>
      prompt === undefined
        ? {
            ...current,
            draft: draft.draft,
            selectionStart: draft.selectionStart,
            selectionEnd: draft.selectionEnd,
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
        });
      },
    );

    return true;
  };

  const editHold = useRef<EditHold | undefined>(undefined);
  const shown = useRef(false);

  const takeHold = (): HeldMessage | undefined => {
    const held = editHold.current?.held;
    editHold.current = undefined;

    return held;
  };

  const releaseHold = (): void => {
    void takeHold()?.release();
  };

  const endEdit = (restored: ComposerViewState): void => {
    releaseHold();
    retarget({ kind: "new" });
    setAttachmentError(undefined);
    updateViewState((current) => ({ ...restored, focused: current.focused }));
  };

  const leaveEdit = (message: MessageId, notice: string): void => {
    const current = latestTarget.current;

    if (current.kind !== "queued" || current.message.id !== message) return;
    const edited = latestViewState.current;

    endEdit(
      edited.draft === contentDraftText(current.message.content) && edited.attachments.length === 0
        ? current.stash
        : draftWith(current.stash, { text: edited.draft, attachments: edited.attachments }),
    );
    setFeedback({ kind: "error", message: notice });
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
    if (target.kind === "queued" && !savingEdit) startHold(target.message.id);
  });

  useMountEffect(() => {
    shown.current = true;
    resumeHold();

    return () => {
      shown.current = false;
      pendingRecall.current = undefined;
      releaseHold();
    };
  });

  const attachInput = (handle: ComposerEditorHandle | null) => {
    editorRef.current = handle;
    inputRef?.(handle);
  };

  const addFiles = async (files: readonly File[]): Promise<void> => {
    if (savingEdit) return;
    setAttachmentReads((count) => count + 1);

    return attachComposerFiles({ files, editor: editorRef.current })
      .then((result) => {
        if (result.attachments.length > 0) {
          updateViewState((current) => ({
            ...current,
            attachments: [...current.attachments, ...result.attachments],
          }));
        }

        setAttachmentError(result.error);
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

  const refuse = (
    message: string,
    sent: {
      readonly document: ComposerDocumentState;
      readonly attachments: readonly ComposerImageAttachment[];
    },
  ): void => {
    const restore = (): void => {
      updateViewState((current) =>
        draftWith(current, { text: sent.document.text, attachments: sent.attachments }),
      );
      setFeedback({ kind: "error", message });
    };

    if (latestViewState.current.draft === "") {
      restore();

      return;
    }

    setFeedback({ kind: "error", message, restore });
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

    const outcome = await deliverSubmission({
      sessionId: steer?.session ?? sessionId,
      submission,
      attachments: sentAttachments,
      delivery,
      onLeave: () => {
        windowTabs.dispatch({ kind: "keep-tab", tabId: submittingTab });
        recalled.current = undefined;
        updateViewState((current) => ({
          ...current,
          draft: "",
          attachments: current.attachments.filter(
            (attachment) => !sentAttachments.includes(attachment),
          ),
          selectionStart: 0,
          selectionEnd: 0,
        }));
        setAttachmentError(undefined);
        setFeedback(undefined);
      },
    });

    switch (outcome.kind) {
      case "empty":
        return;
      case "kept":
        setFeedback({ kind: "error", message: outcome.message });

        return;
      case "refused":
        refuse(outcome.message, { document, attachments: sentAttachments });

        return;
      case "sent":
        if (outcome.note !== undefined) setFeedback({ kind: "command", message: outcome.note });
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
    edit: Extract<ComposerTarget, { readonly kind: "queued" }>,
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
          setFeedback({ kind: "error", message: saved.message });

          return;
        case "revised":
          endEdit(edit.stash);

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
    connection()
      .session(sessionId)
      .run(liveRun)
      .stop()
      .catch((cause: unknown) =>
        setFeedback({
          kind: "error",
          message: `Couldn't stop the response: ${errorMessage(cause)}`,
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

  const sendNextQueued = (): boolean => {
    if (nextIdleQueued === undefined) return false;
    steerPending(nextIdleQueued);

    return true;
  };

  const emptyDraft = currentViewState.draft === "" && attachments.length === 0;

  const emptyEnterSteers =
    questions === undefined && target.kind === "new" && emptyDraft && nextIdleQueued !== undefined;

  const canBeginEdit = questions === undefined && target.kind === "new";

  const queuedEditReason =
    questions === undefined && target.kind === "queued"
      ? "Finish editing the queued message first."
      : undefined;

  const beginEdit = (item: UserMessage): void => {
    if (!canBeginEdit || item.source.kind === "action") return;
    const draft = contentDraftText(item.content);
    retarget({ kind: "queued", message: item, stash: latestViewState.current });
    startHold(item.id);
    setFeedback(undefined);
    setAttachmentError(undefined);
    updateViewState((current) => ({
      ...current,
      draft,
      attachments: [],
      selectionStart: draft.length,
      selectionEnd: draft.length,
    }));
    editorRef.current?.focus();
  };

  const removeOutboxRow = (row: UserMessage): void => {
    messageReceipt(sessionId, row)
      .stop()
      .catch((cause: unknown) => {
        setFeedback({
          kind: "error",
          message: `Couldn't remove the message: ${errorMessage(cause)}`,
        });
      });
  };

  const returnToEditor = (): void => editorRef.current?.focus({ preventScroll: true });

  const dock = (
    <div ref={attachTranscriptDock} {...props(composerStyles.dock)}>
      <div
        data-composer-region
        {...props(composerStyles.region, floating && composerStyles.regionFloating)}
      >
        <div {...props(composerStyles.inputStack)}>
          <div {...props(composerStyles.preComposerOverlay)}>
            <div {...props(composerStyles.preComposerStack)}>
              {feedback !== undefined && (
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
                  {feedback.restore !== undefined && (
                    <Button variant="text" onClick={feedback.restore}>
                      Restore Draft
                    </Button>
                  )}
                  <Button
                    iconOnly
                    icon="x"
                    aria-label="Dismiss notification"
                    onClick={() => setFeedback(undefined)}
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
                rowActions={rowActions}
                editingId={target.kind === "queued" ? target.message.id : undefined}
                canEdit={canBeginEdit}
                editBlocked={queuedEditReason}
                enterSteers={emptyEnterSteers}
                mac={mac}
                onEdit={beginEdit}
                onSteer={steerPending}
                onCancel={cancelPending}
                onRemoveUnsent={removeOutboxRow}
                onEditBlocked={(message) => setFeedback({ kind: "status", message })}
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
            surface="follow-up"
            document={
              questions?.document ?? {
                text: currentViewState.draft,
                selectionStart: currentViewState.selectionStart,
                selectionEnd: currentViewState.selectionEnd,
              }
            }
            onDocumentChange={(document) => {
              if (questions !== undefined) {
                questions.changeDocument(document);

                return;
              }

              if (document.text !== latestViewState.current.draft) {
                setFeedback((current) => (current?.kind === "error" ? current : undefined));
              }

              updateViewState((current) => ({
                ...current,
                draft: document.text,
                selectionStart: document.selectionStart,
                selectionEnd: document.selectionEnd,
              }));
            }}
            onSubmit={
              questions === undefined
                ? target.kind === "queued"
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
            onEmptySubmit={questions === undefined ? sendNextQueued : undefined}
            onRecall={questions === undefined && target.kind === "new" ? recall : undefined}
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
            onFilesSelected={questions === undefined ? (files) => void addFiles(files) : undefined}
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
            onFocusChange={(focused) => updateViewState((current) => ({ ...current, focused }))}
            editing={
              questions !== undefined || target.kind === "new"
                ? undefined
                : {
                    kind: "queued",
                    delivery: target.message.delivery,
                    onCancel: () => endEdit(target.stash),
                  }
            }
          />
          {!floating && <ComposerFooter sessionId={sessionId} active={active} />}
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

/** The drop root wraps the composer, so it never changes while this is mounted. */
function FileDrop({
  element,
  onFiles,
}: {
  readonly element: HTMLElement;
  readonly onFiles: (files: readonly File[]) => void;
}): null {
  const drop = useEffectEvent(onFiles);

  useMountEffect(() => bindComposerFileDrop({ element, onFiles: drop }));

  return null;
}
