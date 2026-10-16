import { threadStyles } from "./thread.stylex.ts";
import { props } from "@stylexjs/stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, PointerEvent, ReactElement, ReactNode, RefObject } from "react";
import type {
  CommandInfo,
  Delivery,
  Revision,
  SessionId,
  SessionInfo,
  SessionView,
  UserContent,
} from "@nyte-ai/sdk";
import { Composer, ComposerFrame } from "../conversation/composer.tsx";
import { attachComposerFiles } from "../conversation/composer-files.ts";
import { composerSource } from "../conversation/composer-suggestions.tsx";
import { bindComposerFileDrop } from "../conversation/composer-file-drop.ts";
import type {
  ComposerDocumentState,
  ComposerSubmission,
} from "../conversation/composer-document.ts";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import { composerSendPlan, sendComposerMessage } from "../conversation/composer-send.ts";
import type {
  BranchModelChoice,
  BranchModelPicker,
  TurnChangesTarget,
} from "../conversation/turn-view.tsx";
import { ModelPicker } from "../conversation/model-picker.tsx";
import { WorkspaceContext } from "./workspace-context.tsx";
import { observeActivation } from "../chrome/open-workspace.tsx";
import { Input } from "@nyte-ai/ui/input";
import { FileTypeIconSprite } from "../components/file-type-icon.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { Button } from "@nyte-ai/ui/button";
import {
  usePaneActions,
  useCanSplitPane,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
} from "../layout/pane-context.tsx";
import {
  activePane,
  BLANK_SELECTION,
  clampSplitRatio,
  clampSplitRatioForSize,
  orderedPanes,
} from "../layout/pane-layout.ts";
import type { PaneId, PaneLayout, PaneState, SplitDirection } from "../layout/pane-layout.ts";
import { useSessionDropTarget, useSessionPaneDropTarget } from "../layout/session-dnd.tsx";
import type { SessionDropTarget } from "../layout/session-dnd.tsx";
import type { BlankViewState, ChatDraft } from "../layout/session-view-state.ts";
import {
  useCatalog,
  useChildSessions,
  useSessionActions,
  useHostState,
  useMentionFiles,
  useRenameSession,
  useSetPreference,
  useSession,
  useSessionChoice,
  useSessionView,
} from "../queries.ts";
import { useSessionRemoval } from "../layout/use-session-removal.ts";
import { macPlatform } from "../platform.ts";
import { connection } from "../sdk.tsx";
import { nyte } from "../nyte.ts";
import type { DesktopModelOption } from "../catalog.ts";
import { conversationTurns } from "../view-helpers.ts";
import type { ConversationTurn, UserMessage } from "../view-helpers.ts";
import { useMountEffect } from "../use-mount-effect.ts";

import { BackgroundWork } from "../conversation/tray/terminals.tsx";
import { ReferenceOpenerProvider } from "../conversation/reference-opener.tsx";
import { Timeline } from "../conversation/timeline.tsx";
import { TranscriptProvider } from "../conversation/transcript.tsx";
import { QuestionTray } from "../conversation/tray/questions.tsx";
import { displayTranscriptParts } from "../conversation/transcript-presentation.ts";
import { conversationMessages, transcriptRows } from "../conversation/transcript-rows.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import {
  activeWorkbenchTab,
  useWorkbenchSnapshot,
  workbenchController,
  workbenchScope,
  workbenchShowsChat,
  workbenchViewKey,
  WORKBENCH_CHAT_TAB,
} from "../workbench/controller.ts";
import { Workbench } from "../workbench/workbench.tsx";
import { workbenchReferenceOpener } from "../workbench/open-reference.ts";
import { openJobTerminal } from "../workbench/terminal-store.ts";
import { SubagentTray, type SubagentTrayView } from "../conversation/tray/agents.tsx";
import { SubagentSessionsProvider } from "../conversation/subagent-sessions.ts";
import { clientActions, clientActionShortcut, clientCapabilities } from "../client-actions.ts";
import { errorMessage } from "../errors.ts";
import { pickerDefaults } from "../preference-projection.ts";
import { modelRefFor, selectedModelOption } from "../conversation/model-picker-state.ts";

const EMPTY_TURNS: readonly ConversationTurn[] = [];

const EMPTY_CHILDREN: readonly SessionInfo[] = [];

const NO_CHANGES: SessionView["changes"] = [];

const NO_COMMANDS: readonly CommandInfo[] = [];

const EMPTY_MODEL_OPTIONS: readonly DesktopModelOption[] = [];

type BlankViewUpdate = (current: BlankViewState) => BlankViewState;

type SessionDeletionState =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly sessionId: SessionId };

function useBlankViewBinding(
  paneId: PaneId,
): readonly [ChatDraft, (update: BlankViewUpdate) => void] {
  const store = usePaneViewStateStore();

  const state = useSyncExternalStore(
    store.subscribe,
    () => store.readBlank(paneId),
    () => store.readBlank(paneId),
  );

  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const draftId = state.id;

  const update = useCallback(
    (change: BlankViewUpdate): void => {
      const current = store.readBlank(paneId);

      // A detached composer can still commit; its writes belong to the draft it showed.
      if (current.id !== draftId) return;
      store.writeBlank(paneId, change(current));
      redraw();
    },
    [draftId, paneId, store],
  );

  return [state, update];
}

function PaneHeader({
  paneId,
  title,
  sessionItems,
  menuTriggerRef,
}: {
  paneId: PaneId;
  title: ReactNode;
  /** Session-only entries appended below the layout entries. */
  sessionItems?: ReactNode;
  menuTriggerRef?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const actions = usePaneActions();
  const host = useHostState();
  const canSplit = useCanSplitPane();
  const mac = macPlatform(host.data?.platform);

  return (
    <div {...props(threadStyles.header)}>
      <span {...props(threadStyles.title)}>{title}</span>
      <span {...props(threadStyles.headerActions)}>
        <Menu>
          <MenuTrigger
            render={<Button iconOnly ref={menuTriggerRef} icon="more" aria-label="Pane actions" />}
          />
          <MenuContent align="end">
            <MenuItem
              icon="split-down"
              meta={clientActionShortcut(clientActions.splitDown, mac)}
              disabled={!canSplit}
              onClick={() => actions.split("down")}
            >
              {clientActions.splitDown.label}
            </MenuItem>
            <MenuItem
              icon="split-right"
              meta={clientActionShortcut(clientActions.splitRight, mac)}
              disabled={!canSplit}
              onClick={() => actions.split("right")}
            >
              {clientActions.splitRight.label}
            </MenuItem>
            <MenuItem icon="x" onClick={() => actions.close(paneId)}>
              Close Pane
            </MenuItem>
            {sessionItems}
          </MenuContent>
        </Menu>
      </span>
    </div>
  );
}

async function applyMessageEdit({
  sessionId,
  message,
  revision,
  content,
  choice,
}: {
  readonly sessionId: SessionId;
  readonly message: UserMessage;
  readonly revision: Revision | null | undefined;
  readonly content: UserContent;
  readonly choice: BranchModelChoice;
}): Promise<void> {
  if (revision == null)
    throw new Error("The conversation is updating. Try editing this message again.");

  const receipt = await connection()
    .session(sessionId)
    .send(content, {
      replace: message.id,
      running: "stop",
      expect: revision,
      ...(choice.model === undefined
        ? {}
        : {
            configuration: {
              model: modelRefFor(choice.model, choice.fast),
              ...(choice.thinkingLevel === undefined ? {} : { thinking: choice.thinkingLevel }),
            },
          }),
    });

  const landed = await receipt.landed();

  switch (landed.kind) {
    case "landed":
      return;
    case "withdrawn":
      throw new Error("The edit was withdrawn before it was sent.");
    case "stale":
      throw new Error("The conversation moved on; review it before editing this message.");
    case "busy":
      throw new Error("The response could not be stopped to edit this message.");
    case "pending-input":
      throw new Error("Messages are queued after this one; send or remove them first.");
    case "missing-target":
      throw new Error("The selected message is no longer in this branch.");
    case "summary-failed":
      throw new Error(landed.reason);
    default: {
      const _exhaustive: never = landed;

      return _exhaustive;
    }
  }
}

type SessionConversationProps =
  | {
      readonly presentation: "full";
      readonly floatingMount: HTMLDivElement | null;
      readonly paneId: PaneId;
      readonly sessionId: SessionId;
      readonly inputRef: (element: ComposerEditorHandle | null) => void;
    }
  | {
      readonly presentation: "tray";
      readonly paneId: PaneId;
      readonly sessionId: SessionId;
      readonly onOpenSubagentTray: (sessionId: SessionId) => void;
    };

function SessionConversation(conversation: SessionConversationProps): ReactElement {
  const { paneId, presentation, sessionId } = conversation;
  const host = useHostState();
  const paneActions = usePaneActions();
  const { layout } = usePaneControllerSnapshot();
  const session = useSession(sessionId);
  const catalog = useCatalog(sessionId);
  const children = useChildSessions(sessionId);
  const renameSession = useRenameSession();
  const sessionActions = useSessionActions();
  const removeSession = useSessionRemoval();
  const [draftName, setDraftName] = useState<string | undefined>();
  const [deletion, setDeletion] = useState<SessionDeletionState>({ kind: "closed" });
  const [navigating, setNavigating] = useState(false);

  const [trayView, setTrayView] = useState<SubagentTrayView | { readonly kind: "terminals" }>({
    kind: "closed",
  });

  const subagentTray: SubagentTrayView =
    trayView.kind === "terminals" ? { kind: "closed" } : trayView;

  const paneMenuTrigger = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<ComposerEditorHandle | null>(null);
  const inputRef = presentation === "full" ? conversation.inputRef : undefined;

  const attachComposer = useCallback(
    (handle: ComposerEditorHandle | null): void => {
      composerRef.current = handle;
      inputRef?.(handle);
    },
    [inputRef],
  );

  const view = useSessionView(sessionId);
  const choice = useSessionChoice(sessionId);

  const turns = useMemo(
    () => (view === undefined ? EMPTY_TURNS : conversationTurns(view).turns),
    [view],
  );

  const viewStore = usePaneViewStateStore();
  const messages = useMemo(() => conversationMessages(view), [view]);
  const activation = view?.activation;
  useLayoutEffect(() => {
    if (activation !== undefined && presentation === "full") observeActivation(activation);
  }, [activation, presentation]);
  const parentRunning = messages.running;

  const working =
    navigating ||
    parentRunning ||
    messages.submitted.some(
      (message) =>
        !messages.held || (message.source.kind !== "child" && message.source.kind !== "job"),
    );

  const cwd = host.data?.workspace?.path;
  // The scrollport arrives as state so everything below it re-runs on the
  // commit that creates the node, not one commit late.
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);

  const ready = view !== undefined;
  const modelOptions = catalog.data?.models ?? EMPTY_MODEL_OPTIONS;

  const configuredModel = choice?.model;
  const thinkingLevel = choice?.thinking;

  const branchModel = useMemo<BranchModelPicker>(() => {
    const selected = selectedModelOption(modelOptions, configuredModel);

    return {
      catalog: catalog.data,
      model: selected?.option,
      thinkingLevel,
      fast: selected?.fast === true,
    };
  }, [catalog.data, configuredModel, modelOptions, thinkingLevel]);

  // These walk the transcript, so they are keyed on the durable inputs: a
  // streaming frame re-renders this component and must not repeat them.
  // The indicator belongs under the last turn the transcript draws, which is
  // not always the last turn in the snapshot.
  const lastTurn = turns.at(-1);
  // A turn that ends in a step group already draws the run's indicator there.
  // One that ends in prose needs it below the prose, or the model looks idle while it
  // prepares its next step.

  const settledWork = useMemo(
    () =>
      lastTurn !== undefined && displayTranscriptParts(lastTurn.messages).at(-1)?.kind === "step",
    [lastTurn],
  );

  const retrying = view?.execution.kind === "retrying" ? view.execution.reason : undefined;

  const rows = useMemo(
    () =>
      transcriptRows({
        loading: view === undefined,
        failed: false,
        turns,
        landing: messages.submitted,
        held: messages.held,
        retrying,
        working,
        running: messages.running,
      }),
    [view, turns, messages.submitted, messages.held, messages.running, retrying, working],
  );

  const title = session.data?.name ?? "New chat";

  const commitRename = (): void => {
    if (draftName === undefined) return;
    const name = draftName.replaceAll(/\s+/g, " ").trim();
    setDraftName(undefined);

    if (name !== "" && name !== title) renameSession.mutate({ sessionId, name });
  };

  const requestDelete = (): void => {
    setDeletion({ kind: "open", sessionId });
  };

  const editUserMessage = useCallback(
    async (message: UserMessage, content: UserContent, edit: BranchModelChoice): Promise<void> => {
      setNavigating(true);

      return applyMessageEdit({
        sessionId,
        message,
        revision: view?.revision,
        content,
        choice: edit,
      }).finally(() => setNavigating(false));
    },
    [sessionId, view?.revision],
  );

  const childSessions = children.data ?? EMPTY_CHILDREN;
  const forwardSubagentTray = presentation === "tray" ? conversation.onOpenSubagentTray : undefined;

  // A card always opens the tray, whatever the child's state; the tray's own
  // expand action is the way to a full chat.
  const openSubagentTray = useCallback(
    (childSessionId: SessionId): void => {
      if (forwardSubagentTray !== undefined) {
        forwardSubagentTray(childSessionId);

        return;
      }

      setTrayView({ kind: "detail", sessionId: childSessionId });
    },
    [forwardSubagentTray],
  );

  const subagentSessions = useMemo(
    () => ({ children: childSessions, open: openSubagentTray }),
    [childSessions, openSubagentTray],
  );

  const openChanges = useCallback(
    (target: TurnChangesTarget): void => {
      const viewKey = workbenchViewKey(cwd);

      const id = workbenchController.actions.openTab({
        view: viewKey,
        tab: {
          kind: "changes",
          scope: { kind: "uncommitted" },
          selectedPath: null,
          pathRevealRevision: 0,
          scrollTop: 0,
        },
        activate: true,
      });

      const tab = workbenchController
        .getView(viewKey)
        .tabs.find((candidate) => candidate.id === id);

      if (tab?.kind !== "changes") return;
      workbenchController.actions.updateTab({
        view: viewKey,
        id,
        kind: "changes",
        patch: {
          scope: { kind: "turn", turnId: target.turnId },
          selectedPath: target.kind === "file" ? target.path : null,
          pathRevealRevision:
            target.kind === "file" ? tab.pathRevealRevision + 1 : tab.pathRevealRevision,
          scrollTop: 0,
        },
      });
    },
    [cwd],
  );

  const snapshotError = false;
  const refetchSnapshot = (): void => undefined;

  return (
    <SubagentSessionsProvider value={subagentSessions}>
      <div
        {...props(threadStyles.screen, presentation === "tray" && threadStyles.embeddedScreen)}
        aria-busy={view === undefined}
      >
        {presentation === "full" && layout.kind === "split" && (
          <PaneHeader
            paneId={paneId}
            menuTriggerRef={paneMenuTrigger}
            title={
              draftName === undefined ? (
                title
              ) : (
                <Input
                  aria-label="Chat name"
                  xstyle={threadStyles.renameInput}
                  value={draftName}
                  onValueChange={setDraftName}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename();

                    if (event.key === "Escape") setDraftName(undefined);
                  }}
                />
              )
            }
            sessionItems={
              <>
                <MenuSeparator />
                <MenuItem icon="pencil" onClick={() => setDraftName(title)}>
                  Rename Chat…
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="trash" variant="danger" onClick={requestDelete}>
                  Delete Chat…
                </MenuItem>
              </>
            }
          />
        )}

        <div {...props(threadStyles.body)}>
          <div ref={setColumn} {...props(threadStyles.conversation)}>
            <TranscriptProvider paneId={paneId} sessionId={sessionId} viewportRef={setScroll}>
              <Timeline
                sessionId={sessionId}
                changes={view?.changes ?? NO_CHANGES}
                ready={ready}
                rows={rows}
                working={working}
                settledWork={settledWork}
                cwd={cwd}
                branchModel={branchModel}
                onEditUser={editUserMessage}
                onOpenChanges={openChanges}
                onRetry={refetchSnapshot}
              />

              {presentation === "full" && (
                <Composer
                  sessionId={sessionId}
                  floatingMount={conversation.floatingMount}
                  backgroundWork={{
                    content: (
                      <>
                        <QuestionTray disabled={snapshotError || navigating} viewport={scroll} />
                        <SubagentTray
                          parentSessionId={sessionId}
                          agents={childSessions}
                          view={subagentTray}
                          onViewChange={setTrayView}
                          onExpand={(childSessionId) => {
                            setTrayView({ kind: "closed" });
                            paneActions.openSessionInPane(paneId, childSessionId);
                          }}
                          onRelease={() => composerRef.current?.focus({ preventScroll: true })}
                          viewport={scroll}
                          detail={
                            subagentTray.kind === "detail" ? (
                              <SessionConversation
                                key={subagentTray.sessionId}
                                presentation="tray"
                                paneId={paneId}
                                sessionId={subagentTray.sessionId}
                                onOpenSubagentTray={openSubagentTray}
                              />
                            ) : null
                          }
                        />
                        <BackgroundWork
                          sessionId={sessionId}
                          open={trayView.kind === "terminals"}
                          onOpenChange={(open) =>
                            setTrayView({ kind: open ? "terminals" : "closed" })
                          }
                          onOpenTerminal={(job) =>
                            openJobTerminal({
                              controller: workbenchController,
                              view: workbenchViewKey(cwd),
                              sessionId,
                              job,
                            })
                          }
                          viewport={scroll}
                        />
                      </>
                    ),
                    onEscape: () => {
                      if (trayView.kind === "closed") return false;
                      setTrayView({ kind: "closed" });

                      return true;
                    },
                  }}
                  execution={view?.execution}
                  pending={messages.queued}
                  unsent={messages.unsent}
                  disabled={view === undefined}
                  fileDropRoot={column}
                  initialViewState={viewStore.readSession(sessionId, paneId).composer}
                  onViewStateChange={(composer) =>
                    viewStore.updateSession(sessionId, paneId, (current) => ({
                      ...current,
                      composer,
                    }))
                  }
                  inputRef={attachComposer}
                />
              )}
            </TranscriptProvider>
          </div>
        </div>
        {presentation === "full" && deletion.kind === "open" && (
          <ConfirmDialog
            open
            title="Delete Chat"
            confirmLabel="Delete Chat"
            description="The chat disappears now. Undo from the notification before it closes."
            finalFocus={paneMenuTrigger}
            onOpenChange={(nextOpen) => {
              if (nextOpen) return;
              setDeletion({ kind: "closed" });
            }}
            onConfirm={() => {
              const { sessionId: targetSessionId } = deletion;
              setDeletion({ kind: "closed" });
              sessionActions.delete(targetSessionId, (id) => removeSession(cwd ?? null, id));
            }}
          />
        )}
      </div>
    </SubagentSessionsProvider>
  );
}

function BlankConversation({
  paneId,
  inputRef,
}: {
  paneId: PaneId;
  inputRef: (element: ComposerEditorHandle | null) => void;
}): ReactElement {
  const host = useHostState();
  const { layout } = usePaneControllerSnapshot();
  const workspace = host.data?.workspace;
  const catalog = useCatalog();
  const workspaceFiles = useMentionFiles(workspace !== undefined);
  const actions = usePaneActions();
  const viewStore = usePaneViewStateStore();
  const [viewState, updateViewState] = useBlankViewBinding(paneId);

  // The raw cause is diagnostic only: it rides in `title`, never in body copy.
  const [startFailure, setStartFailure] = useState<
    | { readonly kind: "start"; readonly cause: string }
    | { readonly kind: "refused"; readonly message: string }
  >();

  const [sending, setSending] = useState(false);

  const attachments = viewState.composer.attachments;
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const blankRef = useRef<HTMLDivElement>(null);

  const attachInput = useCallback(
    (handle: ComposerEditorHandle | null) => {
      editorRef.current = handle;
      inputRef(handle);
    },
    [inputRef],
  );

  const setPreference = useSetPreference();
  const defaults = catalog.data?.defaults;

  const selected = selectedModelOption(catalog.data?.models ?? [], defaults?.model);
  const current = selected?.option;

  const start = async (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): Promise<boolean> => {
    if (sending || attachmentReads !== 0) return false;

    const plan = composerSendPlan({ submission, attachments, commands: [], delivery });

    if (plan.kind !== "message") return false;
    setSending(true);
    setStartFailure(undefined);

    const submitted = viewStore.takeBlank(paneId, {
      ...viewStore.readBlank(paneId).composer,
      draft: document.text,
      selectionStart: document.selectionStart,
      selectionEnd: document.selectionEnd,
    });

    try {
      const session = await connection().sessions.create({
        ...(workspace === undefined ? {} : { workspace: workspace.id }),
        ...(defaults === undefined
          ? {}
          : {
              configuration: {
                model: defaults.model,
                ...(defaults.thinkingLevel === undefined
                  ? {}
                  : { thinking: defaults.thinkingLevel }),
              },
            }),
      });

      await sendComposerMessage(session.id, plan);
      setAttachmentError(undefined);
      setSending(false);
      actions.openSessionInPane(paneId, session.id);

      return true;
    } catch (cause: unknown) {
      viewStore.restoreBlank(paneId, submitted);
      setSending(false);
      setStartFailure({ kind: "start", cause: errorMessage(cause) });

      return false;
    }
  };

  const addFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      setAttachmentReads((count) => count + 1);

      return attachComposerFiles({ files, editor: editorRef.current })
        .then((result) => {
          if (result.attachments.length > 0) {
            updateViewState((state) => ({
              ...state,
              composer: {
                ...state.composer,
                attachments: [...state.composer.attachments, ...result.attachments],
              },
            }));
          }

          setAttachmentError(result.error);
        })
        .finally(() => setAttachmentReads((count) => count - 1));
    },
    [updateViewState],
  );

  const dropDisabled = sending || host.data === undefined;
  useLayoutEffect(() => {
    const element = blankRef.current;

    if (element === null) return undefined;

    return bindComposerFileDrop({
      element,
      disabled: dropDisabled,
      onFiles: (files) => {
        void addFiles(files);
      },
    });
  }, [addFiles, dropDisabled]);

  return (
    <div {...props(threadStyles.screen)}>
      {layout.kind === "split" && <PaneHeader paneId={paneId} title="New chat" />}
      <div ref={blankRef} {...props(threadStyles.blank)}>
        <div {...props(threadStyles.blankColumn)}>
          <WorkspaceContext active={activePane(layout).id === paneId} />
          <ComposerFrame
            surface="new-chat"
            document={{
              text: viewState.composer.draft,
              selectionStart: viewState.composer.selectionStart,
              selectionEnd: viewState.composer.selectionEnd,
            }}
            onDocumentChange={(document) =>
              updateViewState((state) => ({
                ...state,
                composer: {
                  ...state.composer,
                  draft: document.text,
                  selectionStart: document.selectionStart,
                  selectionEnd: document.selectionEnd,
                },
              }))
            }
            onSubmit={start}
            placeholder="Ask Nyte, or type / for skills and @ for context"
            disabled={sending || host.data === undefined}
            suggestionCatalog={composerSource({ commands: NO_COMMANDS, skills: [] }, false)}
            mentionFiles={
              workspace === undefined
                ? { status: "ready", data: [] }
                : composerSource(workspaceFiles.data, workspaceFiles.isError)
            }
            attachments={attachments}
            attachmentBusy={attachmentReads !== 0}
            attachmentError={attachmentError}
            onFilesSelected={(files) => void addFiles(files)}
            onAttachmentRemove={(id) => {
              updateViewState((state) => ({
                ...state,
                composer: {
                  ...state.composer,
                  attachments: state.composer.attachments.filter(
                    (attachment) => attachment.id !== id,
                  ),
                },
              }));
              setAttachmentError(undefined);
            }}
            inputRef={attachInput}
            onFocusChange={(focused) =>
              updateViewState((state) => ({
                ...state,
                composer: { ...state.composer, focused },
              }))
            }
            model={
              <ModelPicker
                catalog={catalog.data}
                current={current}
                thinkingLevel={defaults?.thinkingLevel}
                fast={selected?.fast === true}
                disabled={sending || host.data === undefined}
                onChange={(change) => {
                  const model = pickerDefaults(
                    {
                      model: current,
                      thinkingLevel: defaults?.thinkingLevel,
                      fast: selected?.fast === true,
                    },
                    change,
                  );

                  if (model !== undefined) setPreference.mutate(model);
                }}
              />
            }
          />
          {startFailure !== undefined && (
            <div
              role="alert"
              title={startFailure.kind === "start" ? startFailure.cause : undefined}
              {...props(intent.danger, threadStyles.error)}
            >
              {startFailure.kind === "start"
                ? "Couldn’t start the chat. Try again."
                : startFailure.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function panePreviewRect(
  layout: Extract<PaneLayout, { kind: "split" }>,
  paneId: PaneId,
): CSSProperties {
  const leading = layout.leading === paneId;
  const leadingSize = `${String(layout.ratio * 100)}%`;
  const trailingSize = `${String((1 - layout.ratio) * 100)}%`;

  if (layout.direction === "right") {
    return {
      top: 0,
      left: leading ? 0 : leadingSize,
      width: leading ? leadingSize : trailingSize,
      height: "100%",
    };
  }

  return {
    top: leading ? 0 : leadingSize,
    left: 0,
    width: "100%",
    height: leading ? leadingSize : trailingSize,
  };
}

function dropPreviewRect(layout: PaneLayout, target: SessionDropTarget): CSSProperties {
  const leadingSize = layout.kind === "single" ? "50%" : `${String(layout.ratio * 100)}%`;
  const trailingSize = layout.kind === "single" ? "50%" : `${String((1 - layout.ratio) * 100)}%`;

  switch (target.placement) {
    case "top":
      return { top: 0, left: 0, width: "100%", height: leadingSize };
    case "bottom":
      return { top: leadingSize, left: 0, width: "100%", height: trailingSize };
    case "left":
      return { top: 0, left: 0, width: leadingSize, height: "100%" };
    case "right":
      return { top: 0, left: leadingSize, width: trailingSize, height: "100%" };
    case "center":
      return layout.kind === "single"
        ? { top: 0, left: 0, width: "100%", height: "100%" }
        : panePreviewRect(layout, target.paneId);
    default: {
      const _exhaustive: never = target.placement;

      return _exhaustive;
    }
  }
}

function DropPreview({
  layout,
  target,
}: {
  readonly layout: PaneLayout;
  readonly target: SessionDropTarget;
}): ReactElement {
  return (
    <div aria-hidden="true" {...props(threadStyles.dropPreviewLayer)}>
      <div
        data-nyte-drop-preview=""
        {...props(intent.primary, threadStyles.dropPreview)}
        style={dropPreviewRect(layout, target)}
      />
    </div>
  );
}

/** Places where a key already means something: fields, editors, menus, lists, and dialogs. */
const KEY_OWNERS =
  'input, textarea, select, [contenteditable], [role="textbox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

function keysOwnedOutsidePanes(): boolean {
  const host = document.activeElement;
  let active = host;

  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;

  return (
    active !== null && active.matches(KEY_OWNERS) && host?.closest("[data-nyte-pane-id]") === null
  );
}

/**
 * Typing while nothing owns the keys starts a message in the active pane.
 * Focus moves during keydown, so the browser types the character into the
 * composer itself; a key that belongs elsewhere is never taken.
 */
function TypeToCompose({
  input,
}: {
  readonly input: RefObject<ComposerEditorHandle | null>;
}): null {
  useMountEffect(() => {
    const route = (event: KeyboardEvent): void => {
      const owner = document.activeElement;

      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.length !== 1 ||
        (event.key === " " && owner !== document.body) ||
        event
          .composedPath()
          .some((target) => target instanceof Element && target.matches(KEY_OWNERS))
      )
        return;
      input.current?.focus({ preventScroll: true });
    };

    window.addEventListener("keydown", route);

    return () => window.removeEventListener("keydown", route);
  });

  return null;
}

type PanePosition =
  | { readonly kind: "single" }
  | { readonly kind: "leading"; readonly ratio: number }
  | { readonly kind: "trailing" };

function PaneHost({
  pane,
  position,
  floatingMount,
}: {
  pane: PaneState;
  position: PanePosition;
  floatingMount: HTMLDivElement | null;
}): ReactElement {
  const actions = usePaneActions();
  const { focusRequest, layout } = usePaneControllerSnapshot();
  const viewStore = usePaneViewStateStore();

  // The composer key must follow the active draft id through a subscription:
  // a plain readBlank() call in JSX can be frozen by memoization.
  const blankDraftId = useSyncExternalStore(
    viewStore.subscribe,
    () => viewStore.readBlank(pane.id).id,
    () => viewStore.readBlank(pane.id).id,
  );

  const inputRef = useRef<ComposerEditorHandle | null>(null);
  const attachDropTarget = useSessionPaneDropTarget(pane.id);

  const attachInput = useCallback((element: ComposerEditorHandle | null) => {
    inputRef.current = element;
  }, []);

  const host = useHostState();
  const workspacePath = host.data?.workspace?.path;

  const referenceOpener = useMemo(
    () => workbenchReferenceOpener({ viewKey: workbenchViewKey(workspacePath), workspacePath }),
    [workspacePath],
  );

  useLayoutEffect(() => {
    if (focusRequest.paneId !== pane.id || keysOwnedOutsidePanes()) return;
    inputRef.current?.focus();
  }, [focusRequest.paneId, focusRequest.revision, pane.id]);

  return (
    <section
      ref={attachDropTarget}
      aria-label={`${activePane(layout).id === pane.id ? "Active " : ""}chat pane`}
      data-nyte-pane-id={pane.id}
      {...props(
        threadStyles.pane,
        position.kind === "single" && threadStyles.paneSingle,
        position.kind === "leading" && threadStyles.paneLeading(position.ratio),
        position.kind === "trailing" && threadStyles.paneTrailing,
      )}
      onPointerDown={() => actions.focus(pane.id)}
      onFocusCapture={() => actions.focus(pane.id)}
    >
      {activePane(layout).id === pane.id && <TypeToCompose input={inputRef} />}
      <ReferenceOpenerProvider value={referenceOpener}>
        {pane.selection.kind === "session" ? (
          <SessionConversation
            key={pane.selection.sessionId}
            presentation="full"
            floatingMount={activePane(layout).id === pane.id ? floatingMount : null}
            paneId={pane.id}
            sessionId={pane.selection.sessionId}
            inputRef={attachInput}
          />
        ) : (
          <BlankConversation key={blankDraftId} paneId={pane.id} inputRef={attachInput} />
        )}
      </ReferenceOpenerProvider>
    </section>
  );
}

/**
 * The drag lives in the parent as state: the leading pane renders `dragRatio`
 * while the pointer is down and the layout's ratio otherwise, and the
 * controller only hears about the ratio the pointer released at.
 */
function SplitSash({
  direction,
  ratio,
  dragRatio,
  onDragRatio,
  containerRef,
}: {
  direction: SplitDirection;
  ratio: number;
  dragRatio: number | undefined;
  onDragRatio: (ratio: number | undefined) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const actions = usePaneActions();
  const sashRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(Number.NaN);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const sash = sashRef.current;

    if (container === null || sash === null) return;

    const measure = (): void => {
      setAvailableWidth(
        container.getBoundingClientRect().width -
          (direction === "right" ? sash.getBoundingClientRect().width : 0),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(sash);

    return () => observer.disconnect();
  }, [containerRef, direction]);

  /**
   * Only a side-by-side split can starve a pane of width, so the pixel floor
   * applies on that axis alone; stacked panes keep the full container width
   * whatever the ratio.
   */
  const clampRatio = (nextRatio: number, width: number): number =>
    direction === "right" ? clampSplitRatioForSize(nextRatio, width) : clampSplitRatio(nextRatio);

  useLayoutEffect(() => {
    const clamped =
      direction === "right"
        ? clampSplitRatioForSize(ratio, availableWidth)
        : clampSplitRatio(ratio);

    if (clamped !== ratio) actions.resize(clamped);
  }, [actions, availableWidth, direction, ratio]);

  const ratioFromPointer = (event: PointerEvent<HTMLDivElement>): number | undefined => {
    const container = containerRef.current;

    if (container === null) return undefined;
    const bounds = container.getBoundingClientRect();
    const lane = event.currentTarget.getBoundingClientRect();
    const laneSize = direction === "right" ? lane.width : lane.height;
    const size = (direction === "right" ? bounds.width : bounds.height) - laneSize;

    if (size <= 0) return undefined;
    const pixels = direction === "right" ? event.clientX - bounds.left : event.clientY - bounds.top;

    return clampRatio((pixels - laneSize / 2) / size, availableWidth);
  };

  return (
    <div
      ref={sashRef}
      role="separator"
      tabIndex={0}
      aria-label="Resize chat panes"
      aria-orientation={direction === "right" ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(clampRatio(0, availableWidth) * 100)}
      aria-valuemax={Math.round(clampRatio(1, availableWidth) * 100)}
      aria-valuenow={Math.round((dragRatio ?? ratio) * 100)}
      {...props(
        threadStyles.sash,
        direction === "right" ? threadStyles.sashRight : threadStyles.sashDown,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const nextRatio = ratioFromPointer(event);

        if (nextRatio === undefined) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragRatio(nextRatio);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const nextRatio = ratioFromPointer(event);

        if (nextRatio !== undefined) onDragRatio(nextRatio);
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const nextRatio = ratioFromPointer(event);
        event.currentTarget.releasePointerCapture(event.pointerId);
        onDragRatio(undefined);

        if (nextRatio !== undefined) actions.resize(nextRatio);
      }}
      onLostPointerCapture={() => onDragRatio(undefined)}
      onDoubleClick={() => {
        onDragRatio(undefined);
        actions.resize(0.5);
      }}
      onPointerCancel={() => onDragRatio(undefined)}
      onKeyDown={(event) => {
        const previous = direction === "right" ? "ArrowLeft" : "ArrowUp";
        const next = direction === "right" ? "ArrowRight" : "ArrowDown";

        if (
          event.key !== previous &&
          event.key !== next &&
          event.key !== "Home" &&
          event.key !== "End"
        )
          return;
        event.preventDefault();

        const nextRatio =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? 1
              : ratio + (event.key === previous ? -0.02 : 0.02);

        actions.resize(clampRatio(nextRatio, availableWidth));
      }}
    >
      <span
        {...props(
          threadStyles.sashLine,
          direction === "right" ? threadStyles.sashLineRight : threadStyles.sashLineDown,
        )}
      />
    </div>
  );
}

export function ThreadScreen({
  routeSessionId,
}: {
  routeSessionId: SessionId | undefined;
}): ReactElement {
  const { layout } = usePaneControllerSnapshot();
  const actions = usePaneActions();
  const host = useHostState();
  const containerRef = useRef<HTMLDivElement>(null);
  const [floatingMount, setFloatingMount] = useState<HTMLDivElement | null>(null);
  const workbench = useWorkbenchSnapshot();
  const dropTarget = useSessionDropTarget();
  const [dragRatio, setDragRatio] = useState<number | undefined>();
  const panes = orderedPanes(layout);
  const leading = panes[0] ?? activePane(layout);
  const trailing = layout.kind === "split" ? panes[1] : undefined;
  const activeSelection = activePane(layout).selection;
  const workspacePath = host.data?.workspace?.path;

  const viewKey = workbenchViewKey(workspacePath);
  const view = workbench.views.get(viewKey) ?? workbenchController.getView(viewKey);
  const maximized = view.expanded && view.layout.kind === "maximized";
  const chatShowing = maximized && workbenchShowsChat(view.layout);

  const paneFloatingMount =
    maximized &&
    !chatShowing &&
    activeWorkbenchTab(view, workbenchScope(workspacePath), clientCapabilities(nyte.host))?.kind !==
      "browser"
      ? floatingMount
      : null;

  const syncedRoute = useRef<{ readonly sessionId: SessionId | undefined } | undefined>(undefined);
  useLayoutEffect(() => {
    // A folder switch rebinds `actions` to a controller whose selection was
    // made before the switch; the route follows it. Only a changed route
    // reselects, and the first run aligns a restored layout with the route.
    const synced = syncedRoute.current;

    if (synced !== undefined && synced.sessionId === routeSessionId) return;
    syncedRoute.current = { sessionId: routeSessionId };
    actions.syncRoute(
      routeSessionId === undefined
        ? BLANK_SELECTION
        : { kind: "session", sessionId: routeSessionId },
    );
  }, [actions, routeSessionId]);

  return (
    <div {...props(threadStyles.stage)}>
      <FileTypeIconSprite />
      <div
        ref={containerRef}
        id={`${viewKey}-panel-${WORKBENCH_CHAT_TAB}`}
        role={maximized ? "tabpanel" : undefined}
        aria-labelledby={maximized ? `${viewKey}-tab-${WORKBENCH_CHAT_TAB}` : undefined}
        {...props(
          threadStyles.panes,
          layout.kind === "split" &&
            (layout.direction === "right" ? threadStyles.splitRight : threadStyles.splitDown),
        )}
      >
        <PaneHost
          key={leading.id}
          pane={leading}
          floatingMount={paneFloatingMount}
          position={
            layout.kind === "single"
              ? { kind: "single" }
              : { kind: "leading", ratio: dragRatio ?? layout.ratio }
          }
        />
        {layout.kind === "split" && trailing !== undefined && (
          <SplitSash
            key="pane-sash"
            direction={layout.direction}
            ratio={layout.ratio}
            dragRatio={dragRatio}
            onDragRatio={setDragRatio}
            containerRef={containerRef}
          />
        )}
        {layout.kind === "split" && trailing !== undefined && (
          <PaneHost
            key={trailing.id}
            pane={trailing}
            position={{ kind: "trailing" }}
            floatingMount={paneFloatingMount}
          />
        )}
        {dropTarget !== undefined && <DropPreview layout={layout} target={dropTarget} />}
      </div>
      <Workbench
        workspacePath={workspacePath}
        sessionId={activeSelection.kind === "session" ? activeSelection.sessionId : undefined}
      />
      <div ref={setFloatingMount} {...props(threadStyles.floatingMount)} />
    </div>
  );
}
