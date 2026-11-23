import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ReactElement, ReactNode } from "react";
import type { Delivery, MessageId, SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { PLANNING_LABEL, runMark, taskLabel } from "@nyte-ai/plugin/client/presentation";
import type { RunStatus, UserMessage } from "@nyte-ai/plugin/client/presentation";
import { errorMessage } from "../../contract/errors.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { useCatalog } from "../../data/catalog.ts";
import { useHostLink } from "../../data/host.ts";
import { readLinkNotices } from "../../data/link-notices.ts";
import { useMentionFiles } from "../../data/files.ts";
import { SIDECHAT_COMMAND, usePluginCatalog } from "../../data/plugins.ts";
import { sessionActions } from "../../data/session-rows.ts";
import { useSessionActivity, useSessionChoice } from "../../data/sessions.ts";
import { connected, connection } from "../../data/connection.ts";
import { chatStore, resendMessage, stopChat, useChatStopping } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { useChatFolder, useChats } from "../../chats/index.ts";
import { nyte } from "../../contract/nyte.ts";
import { usePaneViewStateStore } from "../../panes/pane-context.tsx";
import type { ComposerDocumentState, ComposerSubmission } from "../../panes/composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { ComposerFrame } from "./composer-frame.tsx";
import type { ComposerSurface } from "./composer-frame.tsx";
import { sessionModel } from "./model-picker-state.ts";
import { SessionModelChip } from "./composer-model-chip.tsx";
import { cycleModes, modeControl, useSessionModes } from "./composer-modes.tsx";
import { ComposerQueue } from "./composer-queue.tsx";
import { composerSource } from "./composer-suggestions.tsx";
import { bindComposerFileDrop } from "../../references/composer-file-drop.ts";
import { takeFiles } from "./composer-files.ts";
import type { ComposerFile } from "../../references/composer-file-drop.ts";
import { ComposerFooter } from "./composer-footer.tsx";
import { loadedPrompts } from "./composer-history.ts";
import { deliveryChoices, draftEmpty, nextToSteer } from "./composer-keys.ts";
import { deliver, draftCommands } from "./composer-send.ts";
import { planSubmission } from "./composer-plan.ts";
import {
  endedDraft,
  errorNotice,
  handedOff,
  shownDraft,
  shownNotice,
} from "../../panes/composer-draft.ts";
import type { ComposerNotice } from "../../panes/composer-draft.ts";
import { editBlock, FILES_WHILE_SAVING, saving } from "./composer-session.ts";
import type { PendingRowAction } from "./composer-session.ts";
import { composerSession } from "./composer-effects.ts";
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
import { useDebouncedValue } from "../../lib/use-debounced-value.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

const FOLLOW_UP_PLACEHOLDER = "Add a follow-up";

const OUTAGE_GRACE_MS = 1500;

function messageReceipt(sessionId: SessionId, message: UserMessage) {
  return connection().session(sessionId).receipt(asId<"receipt">(message.id));
}

function portalHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.display = "contents";

  return host;
}

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
    readonly tray: { readonly open: boolean; readonly close: () => void };
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

  const [composer] = useState(() =>
    composerSession({
      sessionId,
      drafts: viewStore,
      revised: () => {
        sessionActions.restore(sessionId);
        transcript.end();
      },
    }),
  );

  const state = useSyncExternalStore(composer.subscribe, composer.read);
  const dispatch = composer.dispatch;
  const shownView = shownDraft(draft);
  const attachments = shownView.attachments;
  const feedback = shownNotice(draft);
  const liveRun = "run" in status ? status.run : undefined;
  const mark = useChats((chats) => chats.get(sessionId)?.mark) ?? runMark(status);
  const target = draft.edit;
  const savingEdit = saving(state);
  const folder = useChatFolder();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const mac = nyte.platform === "darwin";
  const link = useHostLink();

  const asked = useChatStopping(sessionId) === "asked";
  const stopping = (status.kind === "working" && status.stopping) || asked;

  const staleSince = useWatchSelect(chatStore(sessionId), (store) =>
    store.value?.freshness.kind === "stale" ? store.value.freshness.since : undefined,
  );

  const away = link === undefined ? null : readLinkNotices(link, false).composer;
  const lostAWhile = useDebouncedValue(away !== null, OUTAGE_GRACE_MS);
  const staleAWhile = useDebouncedValue(staleSince !== undefined, OUTAGE_GRACE_MS);

  const questions = useQuestionDock(sessionId);
  const pluginCatalog = usePluginCatalog(sessionId);
  const modes = useSessionModes(sessionId, pluginCatalog.data?.settings);
  const showsModes = questions === undefined && surface !== "side-chat";
  const floating = floatingMount !== null;
  const [portal] = useState(portalHost);
  const inlineSlot = useRef<HTMLDivElement | null>(null);

  const [attachInlineSlot] = useState(() => (slot: HTMLDivElement | null): void => {
    inlineSlot.current = slot;

    if (slot === null) {
      portal.remove();

      return;
    }

    slot.append(portal);
  });

  const focusAfterMove = useRef(false);
  const cwd = folder?.path;
  const activity = useSessionActivity(floating ? sessionId : undefined, cwd);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- moves the portal host between DOM mounts before paint
  useLayoutEffect(() => {
    const destination = floatingMount ?? inlineSlot.current;

    if (destination === null || portal.parentElement === destination) return;
    destination.append(portal);

    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    composer.editor()?.focus({ preventScroll: true });
  }, [composer, floatingMount, portal]);

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

  const notify = (notice: ComposerNotice | null): void => {
    dispatch({ kind: "notice", notice });
  };

  useMountEffect(() => {
    const show = (): void => setDraft(viewStore.readSession(sessionId).draft);

    const leave = viewStore.subscribeDraft(sessionId, () => {
      show();
      dispatch({ kind: "draft-changed" });
    });

    show();
    dispatch({ kind: "shown" });

    return () => {
      leave();
      dispatch({ kind: "closed" });
    };
  });

  const attachInput = (handle: ComposerEditorHandle | null) => {
    composer.attach(handle);
    inputRef?.(handle);
  };

  const addFiles = async (
    files: readonly ComposerFile[],
    signal?: AbortSignal,
  ): Promise<string | undefined> => {
    if (!dispatch({ kind: "files" })) return FILES_WHILE_SAVING;

    return takeFiles({
      files,
      editor: composer.editor(),
      signal,
      step: (event) => dispatch({ kind: "intake", event }),
      attach: (taken) => dispatch({ kind: "attached", attachments: taken }),
    });
  };

  const setRowAction = (id: string, action: PendingRowAction | null): void => {
    dispatch({ kind: "row", id, action, pending: pending.map((item) => item.id) });
  };

  const send = async (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): Promise<void> => {
    if (!dispatch({ kind: "submit" })) return;
    const sentAttachments = attachments;
    const submittingTab = windowTabs.paneTabId();
    const receipt = asId<"receipt">(crypto.randomUUID());
    const chat = steer?.session ?? sessionId;

    const plan = planSubmission({
      submission,
      attachments: sentAttachments,
      commands: await draftCommands(chat, submission.text),
      delivery,
    });

    if (plan.kind === "empty") return;

    if (plan.kind === "kept") {
      notify(errorNotice(plan.message));

      return;
    }

    const live = await connected();
    windowTabs.dispatch({ kind: "keep-tab", tabId: submittingTab });
    dispatch({ kind: "sent", document, attachments: sentAttachments, receipt });
    const sending = await deliver(live, chat, plan, receipt);

    if (sending.journaled) dispatch({ kind: "handed-off", receipt });

    void sending.ended.then((end) => {
      viewStore.updateDraft(sessionId, (current) =>
        endedDraft(handedOff(current, receipt), end, {
          text: document.text,
          attachments: sentAttachments,
        }),
      );

      if (end.kind === "refused") viewStore.persist();

      if (end.kind !== "sent") return;

      if (end.note !== undefined) notify({ kind: "command", message: end.note, restore: null });
      sessionActions.restore(chat);

      if (steer === undefined) transcript.end();
    });
  };

  const moveToNewChat = (): void => {
    const moved = composer.editor()?.readDocument();

    if (moved === undefined) return;

    windowTabs.newChat({
      folder: cwd,
      composer: {
        draft: moved.text,
        attachments,
        selectionStart: moved.selectionStart,
        selectionEnd: moved.selectionEnd,
      },
    });
    dispatch({ kind: "moved" });
  };

  const abort = (): void => {
    if (liveRun === undefined || stopping) return;
    stopChat(sessionId).catch((cause: unknown) =>
      notify(errorNotice(`Couldn't stop the response: ${errorMessage(cause)}`)),
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
            case "sent":
            case "missing":
              return;
            case "revised":
              setRowAction(item.id, null);

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

  const movePending = (item: UserMessage, after: MessageId | null): void => {
    setRowAction(item.id, { kind: "sending" });

    const failed = (reason: string): void =>
      setRowAction(item.id, { kind: "failed", message: `Couldn't move the message: ${reason}` });

    connection()
      .session(sessionId)
      .reorder(item.id, { after })
      .then(
        (outcome) => {
          if (outcome.kind === "moved") setRowAction(item.id, null);
          else if (outcome.kind === "stale") failed("the queue changed.");
        },
        (cause: unknown) => failed(errorMessage(cause)),
      );
  };

  const nextQueued = nextToSteer(pending);
  const nextQueuedAction = nextQueued === undefined ? undefined : state.rows.get(nextQueued.id);

  const nextIdleQueued =
    nextQueuedAction === undefined || nextQueuedAction.kind === "failed" ? nextQueued : undefined;

  const emptyEnterSteers =
    questions === undefined &&
    target === null &&
    draftEmpty(shownView.draft, attachments.length) &&
    nextIdleQueued !== undefined;

  const blocked = editBlock(draft, questions !== undefined);
  const queuedEditReason =
    blocked === "editing" ? "Finish editing the queued message first." : undefined;

  const removeOutboxRow = (row: UserMessage): void => {
    messageReceipt(sessionId, row)
      .stop()
      .catch((cause: unknown) =>
        notify(errorNotice(`Couldn't remove the message: ${errorMessage(cause)}`)),
      );
  };

  const resendOutboxRow = (row: UserMessage): void => {
    resendMessage(sessionId, row.id).catch((cause: unknown) =>
      notify(errorNotice(`Couldn't send the message: ${errorMessage(cause)}`)),
    );
  };

  const returnToEditor = (): void => composer.editor()?.focus({ preventScroll: true });

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
                    <Button variant="text" onClick={() => dispatch({ kind: "restored" })}>
                      Restore Draft
                    </Button>
                  )}
                  <Button
                    iconOnly
                    icon="x"
                    aria-label="Dismiss notification"
                    onClick={() => notify(null)}
                  />
                </div>
              )}
              {away !== null && lostAWhile ? (
                <div role={away.role} {...props(composerStyles.queued)}>
                  <Icon name="refresh" />
                  <span {...props(composerStyles.queuedText)}>{away.text}</span>
                </div>
              ) : (
                staleSince !== undefined &&
                staleAWhile && (
                  <div role="status" {...props(composerStyles.queued)}>
                    <Icon name="clock" />
                    <span {...props(composerStyles.queuedText)}>
                      {`Chat last updated at ${new Date(staleSince).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}.`}
                    </span>
                  </div>
                )
              )}
              <ComposerQueue
                pending={pending}
                unsent={unsent}
                expired={expired}
                rowActions={state.rows}
                editingId={target === null ? undefined : target.message.id}
                canEdit={blocked === null}
                editBlocked={queuedEditReason}
                enterSteers={emptyEnterSteers}
                mac={mac}
                onEdit={(message) =>
                  dispatch({ kind: "edit", message, asking: questions !== undefined })
                }
                onSteer={steerPending}
                onMove={movePending}
                onCancel={cancelPending}
                onRemoveUnsent={removeOutboxRow}
                onResend={resendOutboxRow}
                onEditBlocked={(message) => notify({ kind: "status", message, restore: null })}
                onReturn={returnToEditor}
              />
            </div>
            <div {...props(composerStyles.preComposerPills)}>
              <QuestionDockContext value={questions}>{backgroundWork?.content}</QuestionDockContext>
              {floating ? (
                <>
                  {liveRun !== undefined && (
                    <span {...props(text.base, composerStyles.floatingStatus)}>
                      <TaskMark state={mark} />
                      <span {...props(composerStyles.floatingStatusText, markerStyles.shimmer)}>
                        {mark === "waiting" ? taskLabel(mark) : (activity ?? PLANNING_LABEL)}
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

              dispatch({ kind: "typed", document });
            }}
            onSubmit={
              questions === undefined
                ? target !== null
                  ? composer.save
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
            tray={
              questions === undefined
                ? backgroundWork?.tray
                : { open: true, close: () => void questions.dismiss() }
            }
            onSteerQueued={
              questions === undefined && nextIdleQueued !== undefined
                ? () => steerPending(nextIdleQueued)
                : undefined
            }
            onCycleMode={showsModes ? cycleModes(modes) : undefined}
            modes={showsModes ? modeControl(modes) : undefined}
            onRecall={
              questions === undefined && target === null
                ? (direction) =>
                    dispatch({
                      kind: "recall",
                      direction,
                      loaded: loadedPrompts(chatStore(sessionId).value),
                    })
                : undefined
            }
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
            attachmentBusy={questions === undefined && state.intake.reads !== 0}
            attachmentError={questions === undefined ? state.intake.error : undefined}
            onFilesSelected={questions === undefined ? addFiles : undefined}
            onAttachmentRemove={(id) => dispatch({ kind: "detached", id })}
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
            onMoveToNewChat={questions === undefined && target === null ? moveToNewChat : undefined}
            editing={
              questions !== undefined || target === null
                ? undefined
                : {
                    kind: "queued",
                    delivery: target.message.delivery,
                    onCancel: () => dispatch({ kind: "edit-cancelled" }),
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
      {createPortal(dock, portal)}
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
