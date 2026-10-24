import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useCallback, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { ReactElement, ReactNode } from "react";
import type { Delivery, Execution, HeldMessage, MessageId, SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { errorMessage } from "../errors.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import {
  useCatalog,
  useHostLink,
  useHostState,
  useMentionFiles,
  usePluginCatalog,
  useSessionActions,
  useSessionActivity,
  useSessionChoice,
} from "../queries.ts";
import { connection } from "../sdk.tsx";
import { nyte } from "../nyte.ts";
import { DEFAULT_COMPOSER_VIEW_STATE } from "../layout/session-view-state.ts";
import type { ComposerViewState } from "../layout/session-view-state.ts";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { ComposerFrame } from "./composer-frame.tsx";
import { selectedModelOption } from "./model-picker-state.ts";
import { SessionModelChip } from "./composer-model-chip.tsx";
import { ComposerQueue } from "./composer-queue.tsx";
import type { PendingRowAction } from "./composer-queue.tsx";
import { composerSource } from "./composer-suggestions.tsx";
import { bindComposerFileDrop } from "./composer-file-drop.ts";
import { attachComposerFiles } from "./composer-files.ts";
import type { ComposerImageAttachment } from "./composer-files.ts";
import { deliveryChoices, nextToSteer } from "./composer-keys.ts";
import { deliverEdit, deliverSubmission } from "./composer-send.ts";
import { contentDraftText } from "./message-references.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { StatusDot } from "../components/ui.tsx";
import { workbenchController, workbenchViewKey } from "../workbench/controller.ts";
import { composerStyles } from "./composer.stylex.ts";
import { markerStyles } from "./activity.stylex.ts";
import { TranscriptButton, useTranscriptControls, useTranscriptDock } from "./transcript.tsx";
import { QuestionDockContext, useQuestionDock } from "./tray/questions-state.ts";
import { useCommitCount } from "../work-counts.ts";

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
  useCommitCount("render:composer");
  const runningMessage = useSetting(preferences.runningMessage);
  const catalog = useCatalog(sessionId);
  const choice = useSessionChoice(sessionId);

  const steers =
    selectedModelOption(catalog.data?.models ?? [], choice?.model)?.option.capabilities.steer !==
    false;

  const runningMessagePreference = steers ? runningMessage : "queue";
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
  const [target, setTarget] = useState<ComposerTarget>({ kind: "new" });
  const [savingEdit, setSavingEdit] = useState(false);
  const host = useHostState();
  const mac = nyte.platform === "darwin";
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
  const cwd = host.data.workspace?.path;
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
  const latestTarget = useRef(target);

  const updateViewState = (update: (current: ComposerViewState) => ComposerViewState): void => {
    const next = update(latestViewState.current);
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

  const endEdit = (restored: ComposerViewState): void => {
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

  const editHold = useRef<HeldMessage | undefined>(undefined);

  const holding = target.kind === "queued" && !savingEdit ? target.message.id : undefined;

  const loseHold = useEffectEvent(leaveEdit);

  useLayoutEffect(() => {
    if (holding === undefined) return undefined;
    let active = true;

    connection()
      .session(sessionId)
      .hold(holding)
      .then(
        (outcome) => {
          if (outcome.kind !== "held") {
            if (active) loseHold(holding, EDIT_ENDED_NOTICES[outcome.kind]);

            return;
          }

          if (!active) {
            void outcome.release();

            return;
          }

          editHold.current = outcome;
          void outcome.lost.then((lost) => {
            if (editHold.current !== outcome) return;
            editHold.current = undefined;
            loseHold(holding, EDIT_ENDED_NOTICES[lost.kind]);
          });
        },
        (cause: unknown) => {
          if (active) loseHold(holding, `Couldn't hold the message: ${errorMessage(cause)}`);
        },
      );

    return () => {
      active = false;
      const held = editHold.current;

      if (held === undefined) return;
      editHold.current = undefined;
      void held.release();
    };
  }, [holding, sessionId]);

  const attachInput = useCallback(
    (handle: ComposerEditorHandle | null) => {
      editorRef.current = handle;
      inputRef?.(handle);
    },
    [inputRef],
  );

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
    const sentAttachments = attachments;

    const outcome = await deliverSubmission({
      sessionId,
      submission,
      attachments: sentAttachments,
      delivery,
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
        return;
      case "kept":
        setFeedback({ kind: "error", message: outcome.message });

        return;
      case "refused":
        refuse(outcome.message, { document, attachments: sentAttachments });

        return;
      case "sent":
        if (outcome.note !== undefined) setFeedback({ kind: "command", message: outcome.note });
        sessionActions.restore(sessionId);
        transcript.end();

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
    const held = editHold.current;
    editHold.current = undefined;
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
          return;
        case "kept":
        case "refused":
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
      .run(liveRun.id)
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

  const sendPendingNow = (item: UserMessage): void => {
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
            message: `Couldn't send: ${errorMessage(cause)}`,
          }),
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
    <div
      ref={attachTranscriptDock}
      {...props(composerStyles.dock, floating && composerStyles.dockFloating)}
    >
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
                editingId={target.kind === "queued" ? target.message.id : undefined}
                canEdit={canBeginEdit}
                editBlocked={queuedEditReason}
                enterSteers={emptyEnterSteers}
                mac={mac}
                onEdit={beginEdit}
                onSendNow={sendPendingNow}
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
                      <StatusDot mark="working" />
                      <span {...props(composerStyles.floatingStatusText, markerStyles.shimmer)}>
                        {activity ?? "Working"}
                      </span>
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    pill
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
                ? target.kind === "queued"
                  ? (submission, delivery) => saveEdit(target, submission, delivery)
                  : send
                : async (_submission, _delivery, document) => {
                    await questions.advance(document);
                  }
            }
            placeholder={
              questions === undefined ? FOLLOW_UP_PLACEHOLDER : "Answer in your own words"
            }
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
            model={questions === undefined ? <SessionModelChip sessionId={sessionId} /> : undefined}
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
