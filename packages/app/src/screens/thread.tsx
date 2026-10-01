import { threadStyles } from "./thread.stylex.ts";
/**
 * The persistent desktop stage. Pane hosts are keyed only by PaneId, so a
 * pane's chrome, size and view-state owner survive a selection change. The
 * conversation inside is keyed by SessionId instead: the virtualized transcript and
 * the composer share one scrollport, and a chat's absolutely positioned rows
 * only leave that scrollport when the surface holding them is replaced.
 */
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
import type { Oid, SessionId, Turn, UserTurnPart } from "@nyte-ai/protocol";
import type { Delivery } from "@nyte-ai/protocol";
import { Composer, ComposerFrame } from "../conversation/composer.tsx";
import { attachComposerFiles } from "../conversation/composer-files.ts";
import type { ComposerImageAttachment } from "../conversation/composer-files.ts";
import { composerSource } from "../conversation/composer-suggestions.tsx";
import { bindComposerFileDrop } from "../conversation/composer-file-drop.ts";
import type {
  ComposerDocumentState,
  ComposerSubmission,
} from "../conversation/composer-document.ts";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import { composerSendInput, composerSendPlan } from "../conversation/composer-send.ts";
import { deliveryChoices } from "../conversation/composer-keys.ts";
import type {
  BranchModelChoice,
  BranchModelPicker,
  TurnChangesTarget,
} from "../conversation/turn-view.tsx";
import { ModelPicker } from "../conversation/model-picker.tsx";
import { WorkspaceContext } from "./workspace-context.tsx";
import { draftConfiguration, updateDraftModel } from "../conversation/blank-draft.ts";
import { Input } from "@nyte-ai/ui/input";
import { FileTypeIconSprite } from "../components/file-type-icon.tsx";
import { Menu, MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
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
import { stopRunAndSettle, useSessionLive } from "../live.ts";
import {
  keys,
  cacheCreatedSession,
  configureSession,
  queryClient,
  useCatalog,
  useChildSessions,
  useSessionActions,
  useHostState,
  useMentionFiles,
  usePluginCatalog,
  usePluginSettings,
  useRenameSession,
  useSession,
  useSessionSnapshot,
} from "../queries.ts";
import { useSessionRemoval } from "../layout/use-session-removal.ts";
import { macPlatform } from "../platform.ts";
import { outbox, useOutboxRows } from "../use-outbox.ts";
import { nyte } from "../nyte.ts";
import type { DesktopModelOption } from "../nyte.ts";
import { sessionReadState } from "../session-read-state.ts";

import { BackgroundWork } from "../conversation/tray/terminals.tsx";
import { ReferenceOpenerProvider } from "../conversation/reference-opener.tsx";
import { Timeline } from "../conversation/timeline.tsx";
import {
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../conversation/message-scroller.tsx";
import { QuestionTray, useComposerAnswer } from "../conversation/tray/questions.tsx";
import {
  NO_WAITS,
  displayTranscriptParts,
  liveWaits,
} from "../conversation/transcript-presentation.ts";
import {
  conversationMessages,
  rendersInTranscript,
  transcriptRows,
} from "../conversation/transcript-rows.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { workbenchController, workbenchViewKey } from "../workbench/controller.ts";
import { Workbench } from "../workbench/workbench.tsx";
import { workbenchReferenceOpener } from "../workbench/open-reference.ts";
import { openJobTerminal } from "../workbench/terminal-store.ts";
import { SubagentTray, type SubagentTrayView } from "../conversation/tray/agents.tsx";
import { SubagentSessionsProvider } from "../conversation/subagent-sessions.ts";
import type { SubagentSession } from "../conversation/subagent-sessions.ts";
import { clientActions, clientActionShortcut } from "../client-actions.ts";
import { errorMessage } from "../errors.ts";

const EMPTY_TURNS: readonly Turn[] = [];

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
        <Menu
          label="Pane actions"
          align="end"
          trigger={<Button iconOnly ref={menuTriggerRef} icon="more" aria-label="Pane actions" />}
        >
          <MenuItem
            icon="split-down"
            meta={clientActionShortcut(clientActions.splitDown, mac)}
            disabled={!canSplit}
            onSelect={() => actions.split("down")}
          >
            {clientActions.splitDown.label}
          </MenuItem>
          <MenuItem
            icon="split-right"
            meta={clientActionShortcut(clientActions.splitRight, mac)}
            disabled={!canSplit}
            onSelect={() => actions.split("right")}
          >
            {clientActions.splitRight.label}
          </MenuItem>
          <MenuItem icon="x" onSelect={() => actions.close(paneId)}>
            Close pane
          </MenuItem>
          {sessionItems}
        </Menu>
      </span>
    </div>
  );
}

async function applyBranchChoice({
  sessionId,
  choice,
  fastEnabled,
}: {
  readonly sessionId: SessionId;
  readonly choice: BranchModelChoice;
  readonly fastEnabled: ReadonlySet<string>;
}): Promise<void> {
  if (choice.model !== undefined) {
    const configuration = {
      sessionId,
      model: { provider: choice.model.provider, id: choice.model.id },
    };

    const configured = await nyte.sessions.configure(
      choice.thinkingLevel === undefined
        ? configuration
        : { ...configuration, thinkingLevel: choice.thinkingLevel },
    );

    if (configured.kind === "unknown_model") {
      throw new Error("That model is no longer available.");
    }

    if (configured.kind === "unknown_agent") {
      throw new Error("The selected mode is no longer available.");
    }
  }

  for (const settingId of new Set([...fastEnabled, ...choice.fastEnabled])) {
    const before = fastEnabled.has(settingId);
    const after = choice.fastEnabled.has(settingId);

    if (before === after) continue;

    const applied = await nyte.plugins.settings.apply({
      sessionId,
      id: settingId,
      choiceId: after ? "on" : "off",
    });

    if (applied.kind !== "applied") {
      throw new Error("That model setting is no longer available.");
    }
  }
}

/**
 * Rewinds the head to a user message and resubmits it with the chosen model.
 * It lives outside the component because the React Compiler cannot lower
 * `try`/`finally`, and one bailout costs the whole component its memoization.
 * A failure before the move leaves the conversation untouched; one after it
 * says so, because the rewind stays.
 */
async function applyMessageEdit({
  sessionId,
  part,
  tip,
  content,
  choice,
  fastEnabled,
  stopped = false,
}: {
  readonly sessionId: SessionId;
  readonly part: UserTurnPart;
  /** The tip the edit was offered against; a branch that moved since is not rewound. */
  readonly tip: Oid | null;
  readonly content: UserTurnPart["content"];
  readonly choice: BranchModelChoice;
  readonly fastEnabled: ReadonlySet<string>;
  /** The run was already stopped for this edit; a second `busy` is not retried. */
  readonly stopped?: boolean;
}): Promise<void> {
  const outcome = await nyte.heads.move({ sessionId, to: part.commit, expect: tip });

  switch (outcome.kind) {
    case "moved":
      if (outcome.restored?.commit !== part.commit) {
        throw new Error("The selected message is no longer editable.");
      }

      try {
        await applyBranchChoice({ sessionId, choice, fastEnabled });
        await outbox.submit({ sessionId, content });
      } catch (cause: unknown) {
        throw new Error(
          `The conversation was rewound to this message, but the edit was not sent: ${errorMessage(cause)}`,
        );
      }

      void queryClient.invalidateQueries({ queryKey: keys.sessions });
      void queryClient.invalidateQueries({ queryKey: keys.pluginSettings(sessionId) });

      return;
    case "busy": {
      // An edit during a response stops it first; the rewind then starts from whatever it left.
      if (stopped) throw new Error("The response could not be stopped to edit this message.");
      const settled = await stopRunAndSettle(sessionId, outcome.run.runId);

      return applyMessageEdit({
        sessionId,
        part,
        tip: settled.tip,
        content,
        choice,
        fastEnabled,
        stopped: true,
      });
    }
    case "moved_since":
      throw new Error("The conversation moved on; review it before editing this message.");
    case "not_found":
      throw new Error("The selected message is no longer in this branch.");
    case "failed":
      throw new Error(outcome.message);
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

type SessionConversationProps =
  | {
      readonly presentation: "full";
      readonly paneId: PaneId;
      readonly sessionId: SessionId;
      readonly inputRef: (element: ComposerEditorHandle | null) => void;
    }
  | {
      readonly presentation: "tray";
      readonly paneId: PaneId;
      readonly sessionId: SessionId;
      readonly onOpenSubagentTray: (sessionId?: SessionId) => void;
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

  const snapshot = useSessionSnapshot(sessionId);
  const snapshotSession = snapshot.data?.session;
  useLayoutEffect(() => {
    if (session.data !== undefined && session.data !== null)
      sessionReadState.markRead(session.data);

    if (snapshotSession !== undefined) sessionReadState.markRead(snapshotSession);
  }, [session.data, snapshotSession]);
  const turns = snapshot.data?.transcript ?? EMPTY_TURNS;
  const live = useSessionLive(sessionId);
  const viewStore = usePaneViewStateStore();
  const unsent = useOutboxRows(sessionId);

  const messages = useMemo(
    () =>
      conversationMessages({
        snapshot: snapshot.data,
        unsent,
        steerDelivery: deliveryChoices.steer,
      }),
    [snapshot.data, unsent],
  );

  const parentRunning = live.runState !== "idle" || messages.running;
  const working = navigating || parentRunning || messages.submitted.length > 0;
  const cwd = host.data?.workspace?.path;
  // The scrollport arrives as state so everything below it re-runs on the
  // commit that creates the node, not one commit late.
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);

  const ready = snapshot.data !== undefined;
  const modelOptions = catalog.data?.models ?? EMPTY_MODEL_OPTIONS;

  const pluginSettings = usePluginSettings(
    sessionId,
    modelOptions.some((option) => option.fastMode.kind === "available"),
  );

  const fastEnabled = useMemo(
    () =>
      new Set(
        (pluginSettings.data ?? [])
          .filter((setting) => setting.current === "on")
          .map((setting) => setting.id),
      ),
    [pluginSettings.data],
  );

  const configuredModel = snapshot.data?.config.model;
  const thinkingLevel = snapshot.data?.config.thinkingLevel;

  const branchModel = useMemo<BranchModelPicker>(
    () => ({
      catalog: catalog.data,
      model: modelOptions.find(
        (option) =>
          option.id === configuredModel?.id &&
          (configuredModel.provider === undefined || option.provider === configuredModel.provider),
      ),
      thinkingLevel,
      fastEnabled,
    }),
    [catalog.data, configuredModel, fastEnabled, modelOptions, thinkingLevel],
  );

  // These walk the transcript, so they are keyed on the durable inputs: a
  // streaming frame re-renders this component and must not repeat them.
  // The indicator belongs under the last turn the transcript draws, which is
  // not always the last turn in the snapshot.
  const lastTurn = useMemo(() => turns.findLast(rendersInTranscript), [turns]);
  // A turn that ends in a work group already draws the run's indicator there,
  // as does one whose live wait on its children is drawn as status. One that
  // ends in prose needs it below the prose, or the model looks idle while it
  // prepares its next step.
  const parked = snapshot.data?.parked;
  const answer = useComposerAnswer(sessionId, parked);

  const lastWaits = useMemo(
    () => (lastTurn?.kind === "turn" ? liveWaits(lastTurn.parts, parked, working) : NO_WAITS),
    [lastTurn, parked, working],
  );

  const settledWork = useMemo(
    () =>
      lastTurn?.kind === "turn" &&
      (lastWaits.hidden.size > 0 ||
        displayTranscriptParts(lastTurn.parts, lastWaits.hidden).at(-1)?.kind === "work"),
    [lastTurn, lastWaits],
  );

  const retrying = live.runState === "retrying" ? live.retry.message : undefined;

  const rows = useMemo(
    () =>
      transcriptRows({
        loading: snapshot.isLoading,
        failed: snapshot.isError,
        turns,
        landing: messages.submitted,
        retrying,
        working,
      }),
    [snapshot.isLoading, snapshot.isError, turns, messages.submitted, retrying, working],
  );

  const title =
    snapshot.data?.session.name ??
    snapshot.data?.session.preview ??
    session.data?.name ??
    session.data?.preview ??
    "New chat";

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
    async (
      part: UserTurnPart,
      content: UserTurnPart["content"],
      choice: BranchModelChoice,
    ): Promise<void> => {
      setNavigating(true);

      return applyMessageEdit({
        sessionId,
        part,
        tip: snapshot.data?.tip ?? null,
        content,
        choice,
        fastEnabled,
      }).finally(() => setNavigating(false));
    },
    [fastEnabled, sessionId, snapshot.data?.tip],
  );

  const childBySession = useMemo(() => {
    const sessions = new Map<SessionId, SubagentSession>();

    for (const turn of turns) {
      if (turn.kind !== "turn" || turn !== lastTurn || !parentRunning) continue;

      for (const part of turn.parts) {
        if (
          part.kind !== "tool" ||
          part.class.kind !== "delegate" ||
          part.class.role !== "create" ||
          part.result?.isError === true
        )
          continue;
        sessions.set(part.class.target.session, {
          kind: "provisional",
          sessionId: part.class.target.session,
          title: part.class.title,
          startedAt: part.at,
        });
      }
    }

    for (const child of children.data ?? []) sessions.set(child.sessionId, child);

    return sessions;
  }, [children.data, lastTurn, parentRunning, turns]);

  const childSessions = useMemo(() => [...childBySession.values()], [childBySession]);
  const forwardSubagentTray = presentation === "tray" ? conversation.onOpenSubagentTray : undefined;

  // A card always opens the tray, whatever the child's state; the tray's own
  // expand action is the way to a full chat.
  const openSubagentTray = useCallback(
    (childSessionId?: SessionId): void => {
      if (forwardSubagentTray !== undefined) {
        forwardSubagentTray(childSessionId);

        return;
      }

      setTrayView(
        childSessionId === undefined
          ? { kind: "list", retainedSessionId: undefined }
          : { kind: "detail", sessionId: childSessionId },
      );
    },
    [forwardSubagentTray],
  );

  const subagentSessions = useMemo(
    () => ({ children: childBySession, open: openSubagentTray }),
    [childBySession, openSubagentTray],
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

  const snapshotError = snapshot.isError;
  const refetchSnapshot = snapshot.refetch;

  return (
    <SubagentSessionsProvider value={subagentSessions}>
      <div
        {...props(threadStyles.screen, presentation === "tray" && threadStyles.embeddedScreen)}
        aria-busy={snapshot.isLoading}
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
                  autoFocus
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
                <MenuItem icon="pencil" onSelect={() => setDraftName(title)}>
                  Rename
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="trash" danger onSelect={requestDelete}>
                  Delete
                </MenuItem>
              </>
            }
          />
        )}

        <div {...props(threadStyles.body)}>
          <div {...props(threadStyles.conversation)}>
            <MessageScrollerProvider
              paneId={paneId}
              sessionId={sessionId}
              autoScroll
              scrollEdgeThreshold={60}
            >
              <MessageScrollerViewport ref={setScroll}>
                <Timeline
                  sessionId={sessionId}
                  ready={ready}
                  rows={rows}
                  working={working}
                  settledWork={settledWork}
                  waits={lastWaits}
                  cwd={cwd}
                  branchModel={branchModel}
                  onEditUser={editUserMessage}
                  onOpenChanges={openChanges}
                  onRetry={refetchSnapshot}
                />

                {presentation === "full" && (
                  <Composer
                    sessionId={sessionId}
                    answer={answer}
                    backgroundWork={{
                      content: (
                        <>
                          <QuestionTray
                            sessionId={sessionId}
                            parked={parked}
                            disabled={snapshotError || navigating}
                            viewport={scroll}
                          />
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
                            onOpenTerminal={(job, activate) =>
                              openJobTerminal({
                                controller: workbenchController,
                                view: workbenchViewKey(cwd),
                                sessionId,
                                job,
                                activate,
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
                    run={snapshot.data?.run}
                    // The boundary delivery draws in the transcript; the tray keeps the rest.
                    pending={messages.queued}
                    unsent={messages.unsent}
                    disabled={snapshot.data === undefined || snapshot.isError}
                    fileDropRoot={scroll}
                    initialViewState={viewStore.readSession(sessionId, paneId).composer}
                    onViewStateChange={(composer) =>
                      viewStore.updateSession(sessionId, paneId, (current) => ({
                        ...current,
                        composer,
                      }))
                    }
                    inputRef={attachComposer}
                    autoFocus={false}
                  />
                )}
              </MessageScrollerViewport>
            </MessageScrollerProvider>
          </div>
        </div>
        {presentation === "full" && deletion.kind === "open" && (
          <ConfirmDialog
            open
            title="Delete Chat"
            confirmLabel="Delete Chat"
            description="The chat disappears now. Undo from the notification before it closes."
            returnFocusRef={paneMenuTrigger}
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

/**
 * Turns fast mode on for a new chat. The throw lives here because the React
 * Compiler cannot lower a `throw` inside `try`/`catch`, and the bailout would
 * cost the blank composer its memoization.
 */
async function enableFastMode(sessionId: SessionId, settingId: string): Promise<void> {
  const outcome = await nyte.plugins.settings.apply({ sessionId, id: settingId, choiceId: "on" });

  if (outcome.kind !== "applied") throw new Error("Fast mode is no longer available");
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
  const pluginCatalog = usePluginCatalog();
  const workspaceFiles = useMentionFiles(workspace !== undefined);
  const actions = usePaneActions();
  const viewStore = usePaneViewStateStore();
  const [viewState, updateViewState] = useBlankViewBinding(paneId);
  // The raw cause is diagnostic only: it rides in `title`, never in body copy.
  const [startFailure, setStartFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<readonly ComposerImageAttachment[]>([]);
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

  const configuration = draftConfiguration(catalog.data, viewState.configuration);

  const current = catalog.data?.models.find(
    (option) =>
      option.provider === configuration?.model.provider && option.id === configuration.model.id,
  );

  const start = async (
    submission: ComposerSubmission,
    delivery: Delivery,
    document: ComposerDocumentState,
  ): Promise<boolean> => {
    if (sending || attachmentReads !== 0) return false;
    // A new chat has no plugin commands active yet; its first message is always a message.
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

    const submittedConfiguration = draftConfiguration(catalog.data, submitted.configuration);

    const submittedModel = catalog.data?.models.find(
      (option) =>
        option.provider === submittedConfiguration?.model.provider &&
        option.id === submittedConfiguration.model.id,
    );

    try {
      const session = await nyte.sessions.create();

      if (submittedConfiguration !== undefined) {
        await configureSession(session.sessionId, submittedConfiguration);
      }

      if (
        submittedModel?.fastMode.kind === "available" &&
        submitted.fastSettings.has(submittedModel.fastMode.settingId)
      ) {
        await enableFastMode(session.sessionId, submittedModel.fastMode.settingId);
      }

      await outbox.submit(composerSendInput(session.sessionId, plan));
      await cacheCreatedSession({ session, workspacePath: workspace?.path ?? null });
      setAttachments([]);
      setAttachmentError(undefined);
      actions.openSessionInPane(paneId, session.sessionId);

      return true;
    } catch (cause: unknown) {
      viewStore.restoreBlank(paneId, submitted);
      setSending(false);
      setStartFailure(errorMessage(cause));

      return false;
    }
  };

  const addFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    setAttachmentReads((count) => count + 1);

    return attachComposerFiles({ files, editor: editorRef.current })
      .then((result) => {
        if (result.attachments.length > 0) {
          setAttachments((current) => [...current, ...result.attachments]);
        }

        setAttachmentError(result.error);
      })
      .finally(() => setAttachmentReads((count) => count - 1));
  }, []);

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
                configuration: state.configuration ?? catalog.data?.defaults,
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
            suggestionCatalog={composerSource(pluginCatalog.data, pluginCatalog.isError)}
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
              setAttachments((current) => current.filter((attachment) => attachment.id !== id));
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
                thinkingLevel={configuration?.thinkingLevel}
                fastEnabled={viewState.fastSettings}
                disabled={sending || host.data === undefined}
                onChange={(change) =>
                  updateViewState((state) =>
                    updateDraftModel({ state, defaults: catalog.data?.defaults, change }),
                  )
                }
              />
            }
          />
          {startFailure !== undefined && (
            <div role="alert" title={startFailure} {...props(intent.danger, threadStyles.error)}>
              Couldn&rsquo;t start the chat. Try again.
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

type PanePosition =
  | { readonly kind: "single" }
  | { readonly kind: "leading"; readonly ratio: number }
  | { readonly kind: "trailing" };

function PaneHost({ pane, position }: { pane: PaneState; position: PanePosition }): ReactElement {
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
    if (focusRequest.paneId === pane.id) inputRef.current?.focus();
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
      <ReferenceOpenerProvider value={referenceOpener}>
        {pane.selection.kind === "session" ? (
          <SessionConversation
            key={pane.selection.sessionId}
            presentation="full"
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
  containerRef: React.RefObject<HTMLDivElement | null>;
}): ReactElement {
  const actions = usePaneActions();

  /**
   * Only a side-by-side split can starve a pane of width, so the pixel floor
   * applies on that axis alone; stacked panes keep the full container width
   * whatever the ratio.
   */
  const clampRatio = (nextRatio: number, width: number): number =>
    direction === "right" ? clampSplitRatioForSize(nextRatio, width) : clampSplitRatio(nextRatio);

  const ratioFromPointer = (event: PointerEvent<HTMLDivElement>): number | undefined => {
    const container = containerRef.current;

    if (container === null) return undefined;
    const bounds = container.getBoundingClientRect();
    const size = direction === "right" ? bounds.width : bounds.height;

    if (size <= 0) return undefined;
    const pixels = direction === "right" ? event.clientX - bounds.left : event.clientY - bounds.top;

    return clampRatio(pixels / size, bounds.width);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize chat panes"
      aria-orientation={direction === "right" ? "vertical" : "horizontal"}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(ratio * 100)}
      {...props(
        threadStyles.sash,
        direction === "right" ? threadStyles.sashRight : threadStyles.sashDown,
      )}
      onPointerDown={(event) => {
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
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        onDragRatio(undefined);

        if (dragRatio !== undefined) actions.resize(dragRatio);
      }}
      onPointerCancel={() => onDragRatio(undefined)}
      onKeyDown={(event) => {
        const previous = direction === "right" ? "ArrowLeft" : "ArrowUp";
        const next = direction === "right" ? "ArrowRight" : "ArrowDown";

        if (event.key !== previous && event.key !== next) return;
        event.preventDefault();
        const step = event.shiftKey ? 0.1 : 0.02;
        const width = containerRef.current?.getBoundingClientRect().width ?? Number.NaN;
        actions.resize(clampRatio(ratio + (event.key === previous ? -step : step), width));
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
  const dropTarget = useSessionDropTarget();
  const [dragRatio, setDragRatio] = useState<number | undefined>();
  const panes = orderedPanes(layout);
  const leading = panes[0] ?? activePane(layout);
  const trailing = layout.kind === "split" ? panes[1] : undefined;
  const activeSelection = activePane(layout).selection;
  const workspacePath = host.data?.workspace?.path;

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
        {...props(
          threadStyles.panes,
          layout.kind === "split" &&
            (layout.direction === "right" ? threadStyles.splitRight : threadStyles.splitDown),
        )}
      >
        <PaneHost
          key={leading.id}
          pane={leading}
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
          <PaneHost key={trailing.id} pane={trailing} position={{ kind: "trailing" }} />
        )}
        {dropTarget !== undefined && <DropPreview layout={layout} target={dropTarget} />}
      </div>
      <Workbench
        workspacePath={workspacePath}
        sessionId={activeSelection.kind === "session" ? activeSelection.sessionId : undefined}
      />
    </div>
  );
}
