import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactElement, ReactNode } from "react";
import type { Delivery, Execution, SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { errorMessage } from "../errors.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import {
  useHostLink,
  useHostState,
  useMentionFiles,
  usePluginCatalog,
  useSessionActions,
  useSessionActivity,
} from "../queries.ts";
import { connection } from "../sdk.tsx";
import { macPlatform } from "../platform.ts";
import { DEFAULT_COMPOSER_VIEW_STATE } from "../layout/session-view-state.ts";
import type { ComposerViewState } from "../layout/session-view-state.ts";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { ComposerFrame } from "./composer-frame.tsx";
import { SessionModelChip } from "./composer-model-chip.tsx";
import { ComposerQueue } from "./composer-queue.tsx";
import type { PendingRowAction } from "./composer-queue.tsx";
import { composerSource } from "./composer-suggestions.tsx";
import { bindComposerFileDrop } from "./composer-file-drop.ts";
import { attachComposerFiles } from "./composer-files.ts";
import type { ComposerImageAttachment } from "./composer-files.ts";
import { deliveryChoices, nextToSteer } from "./composer-keys.ts";
import { deliverSubmission } from "./composer-send.ts";
import { contentDraftText } from "./message-references.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { StatusDot } from "../components/ui.tsx";
import { workbenchController, workbenchViewKey } from "../workbench/controller.ts";
import { composerStyles, markerStyles } from "./styles.stylex.ts";
import { TranscriptButton, useTranscriptControls, useTranscriptDock } from "./transcript.tsx";
import { QuestionDockContext, useQuestionDock } from "./tray/questions-state.ts";

const FOLLOW_UP_PLACEHOLDER = "Add a follow-up";

interface ComposerFeedback {
  readonly kind: "status" | "command" | "error";
  readonly message: string;
  /** Puts a draft the send refused back in front of whatever was typed since. */
  readonly restore?: () => void;
}

interface PendingEdit {
  readonly message: UserMessage;
  readonly delivery: Delivery;
}

function messageReceipt(sessionId: SessionId, message: UserMessage) {
  return connection().session(sessionId).receipt(asId<"receipt">(message.id));
}

function draftWith(document: ComposerDocumentState, words: string): ComposerDocumentState {
  const joined = document.text === "" ? words : `${words}\n${document.text}`;

  return { text: joined, selectionStart: joined.length, selectionEnd: joined.length };
}

/**
 * The follow-up composer of a chat. Admission is open (invariant 5): sending
 * while a run is live is not an error. Enter uses the selected queue or steer
 * delivery and Cmd/Ctrl+Enter the other; the queue card above it holds the
 * still-pending follow-ups, and Enter on an empty composer steers with the
 * first one the run can take. While that one is mid-action, Enter waits
 * rather than reaching past it and reordering the queue. Esc requests a
 * durable abort.
 *
 * The composer takes input before the chat's first view arrives; a send that
 * needs the view waits for it. Sends settle later than the render that
 * started them, so they read the draft as it is then. A refused send puts its
 * draft back, unless something newer is there; then the notice offers it.
 */
export function Composer({
  sessionId,
  execution,
  pending,
  unsent,
  initialViewState = DEFAULT_COMPOSER_VIEW_STATE,
  onViewStateChange,
  inputRef,
  fileDropRoot,
  backgroundWork,
  floatingMount = null,
}: {
  sessionId: SessionId;
  execution: Execution | undefined;
  pending: readonly UserMessage[];
  unsent: readonly UserMessage[];
  /**
   * The draft to start from. The composer owns the draft while mounted and
   * reports each change; a keystroke must not re-render the transcript behind
   * it, so the parent persists without redrawing. Remount (key) to reseed.
   */
  initialViewState?: ComposerViewState;
  onViewStateChange?: (state: ComposerViewState) => void;
  inputRef?: (element: ComposerEditorHandle | null) => void;
  fileDropRoot?: HTMLElement | null;
  backgroundWork?: {
    readonly content: ReactNode;
    readonly onEscape: () => boolean;
  };
  floatingMount?: HTMLDivElement | null;
}): ReactElement {
  const runningMessagePreference = useSetting(preferences.runningMessage);
  const attachTranscriptDock = useTranscriptDock();
  const transcript = useTranscriptControls();
  const [currentViewState, setCurrentViewState] = useState(initialViewState);
  const attachments = currentViewState.attachments;
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [feedback, setFeedback] = useState<ComposerFeedback>();
  const [rowActions, setRowActions] = useState<ReadonlyMap<string, PendingRowAction>>(new Map());
  const liveRun = execution === undefined || execution.kind === "idle" ? undefined : execution.run;
  const stopping = execution?.kind === "live" && execution.stopping;
  const [pendingEdit, setPendingEdit] = useState<PendingEdit>();
  const host = useHostState();
  const mac = macPlatform(host.data?.platform);
  const link = useHostLink();
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const questions = useQuestionDock(sessionId);
  const pluginCatalog = usePluginCatalog(sessionId);
  const sessionActions = useSessionActions();
  const floating = floatingMount !== null;

  const [portalHost] = useState(() => {
    const element = document.createElement("div");
    element.style.display = "contents";

    return element;
  });

  const inlineSlot = useRef<HTMLDivElement | null>(null);
  const focusAfterMove = useRef(false);
  const cwd = host.data?.workspace?.path;
  const activity = useSessionActivity(floating ? sessionId : undefined, cwd);

  const attachInlineSlot = useCallback(
    (slot: HTMLDivElement | null): void => {
      inlineSlot.current = slot;

      if (slot === null) {
        portalHost.remove();

        return;
      }

      slot.append(portalHost);
    },
    [portalHost],
  );

  useLayoutEffect(() => {
    const destination = floatingMount ?? inlineSlot.current;

    if (destination === null || portalHost.parentElement === destination) return;
    destination.append(portalHost);

    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    editorRef.current?.focus({ preventScroll: true });
  }, [floatingMount, portalHost]);

  const suggestionCatalog = composerSource(pluginCatalog.data, pluginCatalog.isError);
  const workspaceFiles = useMentionFiles(true);
  const mentionFiles = composerSource(workspaceFiles.data, workspaceFiles.isError);
  const latestViewState = useRef(currentViewState);

  const updateViewState = useCallback(
    (update: (current: ComposerViewState) => ComposerViewState): void => {
      const next = update(latestViewState.current);
      latestViewState.current = next;
      setCurrentViewState(next);
      onViewStateChange?.(next);
    },
    [onViewStateChange],
  );

  const attachInput = useCallback(
    (handle: ComposerEditorHandle | null) => {
      editorRef.current = handle;
      inputRef?.(handle);
    },
    [inputRef],
  );

  const addFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
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
    },
    [updateViewState],
  );

  useLayoutEffect(() => {
    if (fileDropRoot === undefined || fileDropRoot === null) return undefined;

    return bindComposerFileDrop({
      element: fileDropRoot,
      onFiles: (files) => {
        void addFiles(files);
      },
    });
  }, [addFiles, fileDropRoot]);

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
      updateViewState((current) => {
        const document = draftWith(
          {
            text: current.draft,
            selectionStart: current.selectionStart,
            selectionEnd: current.selectionEnd,
          },
          sent.document.text,
        );

        return {
          ...current,
          draft: document.text,
          attachments: [...sent.attachments, ...current.attachments],
          selectionStart: document.selectionStart,
          selectionEnd: document.selectionEnd,
        };
      });
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
  ): Promise<boolean> => {
    if (attachmentReads !== 0) return false;
    const sentAttachments = attachments;
    const edit = pendingEdit;

    const outcome = await deliverSubmission({
      sessionId,
      submission,
      attachments: sentAttachments,
      delivery,
      replacing: edit?.message,
      onLeave: () => {
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
        return false;
      case "kept":
        setFeedback({ kind: "error", message: outcome.message });

        return false;
      case "refused":
        refuse(outcome.message, { document, attachments: sentAttachments });

        return false;
      case "sent":
        if (edit !== undefined) setPendingEdit(undefined);

        if (outcome.note !== undefined) setFeedback({ kind: "command", message: outcome.note });
        sessionActions.restore(sessionId);
        transcript.end();

        return true;
      default: {
        const _exhaustive: never = outcome;

        return _exhaustive;
      }
    }
  };

  const abort = (): void => {
    if (liveRun === undefined || stopping) return;
    connection()
      .session(sessionId)
      .run(liveRun.id)
      .stop()
      .catch(() => undefined);
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

  const sendPendingNow = (item: UserMessage): void => {
    setRowAction(item.id, { kind: "sending" });
    connection()
      .session(sessionId)
      .send(item.content, { replace: item.id, delivery: deliveryChoices.steer })
      .catch((cause: unknown) =>
        setRowAction(item.id, { kind: "failed", message: `Couldn't send: ${errorMessage(cause)}` }),
      );
  };

  const nextQueued = nextToSteer(pending, deliveryChoices);
  const nextQueuedAction = nextQueued === undefined ? undefined : rowActions.get(nextQueued.id);

  const nextIdleQueued =
    nextQueuedAction === undefined || nextQueuedAction.kind === "failed" ? nextQueued : undefined;

  const sendNextQueued = (): boolean => {
    if (nextIdleQueued === undefined) return false;
    sendPendingNow(nextIdleQueued);

    return true;
  };

  const emptyDraft = currentViewState.draft === "" && attachments.length === 0;
  const emptyEnterSteers = questions === undefined && emptyDraft && nextIdleQueued !== undefined;
  const canBeginEdit = questions === undefined && emptyDraft && pendingEdit === undefined;

  const queuedEditReason =
    canBeginEdit || questions !== undefined
      ? undefined
      : pendingEdit !== undefined
        ? "Finish editing the queued message first."
        : "Send or clear your draft to edit this message.";

  const beginEdit = (item: UserMessage): void => {
    if (!canBeginEdit || item.source.kind === "action") return;
    const draft = contentDraftText(item.content);
    setPendingEdit({ message: item, delivery: item.delivery });
    setFeedback(undefined);
    updateViewState((current) => ({
      ...current,
      draft,
      attachments: [],
      selectionStart: draft.length,
      selectionEnd: draft.length,
    }));
    editorRef.current?.focus();
  };

  const cancelEdit = (): void => {
    setPendingEdit(undefined);
    setAttachmentError(undefined);
    updateViewState((current) => ({
      ...current,
      draft: "",
      attachments: [],
      selectionStart: 0,
      selectionEnd: 0,
    }));
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

  const sendOutboxRowNow = (row: UserMessage): void => {
    void connection()
      .session(sessionId)
      .send(row.content, { replace: row.id, delivery: deliveryChoices.steer })
      .catch((cause: unknown) => {
        setFeedback({ kind: "error", message: `Couldn't send: ${errorMessage(cause)}` });
      });
  };

  const returnToEditor = (): void => editorRef.current?.focus({ preventScroll: true });

  const dock = (
    <div
      ref={attachTranscriptDock}
      {...props(composerStyles.dock, floating && composerStyles.dockFloating)}
    >
      <div
        role="region"
        aria-label="Conversation input"
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
              {link !== undefined && link.kind !== "connected" && (
                <div
                  role={link.kind === "closed" ? "alert" : "status"}
                  {...props(composerStyles.queued)}
                >
                  <Icon name={link.kind === "closed" ? "warning" : "refresh"} />
                  <span {...props(composerStyles.queuedText)}>
                    {link.kind === "closed"
                      ? "Disconnected from the host."
                      : "Reconnecting to the host…"}
                  </span>
                </div>
              )}
              <ComposerQueue
                pending={pending}
                unsent={unsent}
                rowActions={rowActions}
                editingId={pendingEdit?.message.id}
                canEdit={canBeginEdit}
                editBlocked={queuedEditReason}
                enterSteers={emptyEnterSteers}
                mac={mac}
                onEdit={beginEdit}
                onSendNow={sendPendingNow}
                onCancel={cancelPending}
                onRemoveUnsent={removeOutboxRow}
                onSendUnsentNow={sendOutboxRowNow}
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
                      <StatusDot mark="working" />
                      <span {...props(composerStyles.floatingStatusText, markerStyles.shimmer)}>
                        {activity ?? "Working"}
                      </span>
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="chip"
                    onClick={() => {
                      focusAfterMove.current = true;
                      workbenchController.actions.showChat({ view: workbenchViewKey(cwd) });
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
                ? send
                : (_submission, _delivery, document) =>
                    questions.advance(document).then(
                      () => true,
                      () => false,
                    )
            }
            placeholder={
              questions === undefined ? FOLLOW_UP_PLACEHOLDER : "Answer in your own words"
            }
            floating={floating}
            disabled={questions?.pending === true || questions?.settled === true}
            busy={liveRun !== undefined}
            runningMessagePreference={runningMessagePreference}
            answering={questions !== undefined}
            stopping={stopping}
            onAbort={abort}
            onDismissTray={
              questions === undefined
                ? backgroundWork?.onEscape
                : () => {
                    void questions.dismiss().catch(() => undefined);

                    return true;
                  }
            }
            onEmptySubmit={questions === undefined ? sendNextQueued : undefined}
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
            model={questions === undefined ? <SessionModelChip sessionId={sessionId} /> : undefined}
            inputRef={attachInput}
            onFocusChange={(focused) => updateViewState((current) => ({ ...current, focused }))}
            editing={
              questions !== undefined || pendingEdit === undefined
                ? undefined
                : { kind: "queued", delivery: pendingEdit.delivery, onCancel: cancelEdit }
            }
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div ref={attachInlineSlot} {...props(composerStyles.portalSlot)} />
      {createPortal(dock, portalHost)}
    </>
  );
}
