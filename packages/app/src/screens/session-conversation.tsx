/**
 * A chat in a pane: its transcript, composer, trays and pane menu. The tray
 * presentation draws a subagent's chat inside its parent's tray.
 */
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { threadStyles } from "./thread.stylex.ts";
import { modelConfiguration } from "./model-configuration.ts";
import { PaneHeader } from "./pane-header.tsx";
import { props } from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Revision, SessionId, SessionInfo, SessionView, UserContent } from "@nyte-ai/sdk";
import { Composer } from "../conversation/composer.tsx";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import type {
  BranchModelChoice,
  BranchModelPicker,
  TurnChangesTarget,
} from "../conversation/turn-view.tsx";
import { observeActivation } from "../chrome/open-workspace.tsx";
import { Input } from "@nyte-ai/ui/input";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import {
  hideFromPanes,
  usePaneActions,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
} from "../layout/pane-context.tsx";
import type { PaneId } from "../layout/pane-layout.ts";
import {
  useCatalog,
  useChildSessions,
  useSessionActions,
  useHostState,
  useRenameSession,
  useSession,
  useSessionChoice,
  useSessionState,
} from "../queries.ts";
import { connection } from "../sdk.tsx";
import type { DesktopModelOption } from "../catalog.ts";
import { conversationTurns } from "../view-helpers.ts";
import type { ConversationTurn } from "../view-helpers.ts";

import { BackgroundWork } from "../conversation/tray/terminals.tsx";
import { Timeline } from "../conversation/timeline.tsx";
import { TranscriptProvider } from "../conversation/transcript.tsx";
import { QuestionTray } from "../conversation/tray/questions.tsx";
import { displayTranscriptParts } from "../conversation/transcript-presentation.ts";
import { conversationMessages, transcriptRows } from "../conversation/transcript-rows.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { workbenchController, workbenchViewKey } from "../workbench/controller.ts";
import { openJobTerminal } from "../workbench/terminal-store.ts";
import { SubagentTray, type SubagentTrayView } from "../conversation/tray/agents.tsx";
import { SubagentSessionsProvider } from "../conversation/subagent-sessions.ts";
import { modelRefFor, selectedModelOption } from "../conversation/model-picker-state.ts";

const EMPTY_TURNS: readonly ConversationTurn[] = [];

const EMPTY_CHILDREN: readonly SessionInfo[] = [];

const NO_CHANGES: SessionView["changes"] = [];

const EMPTY_MODEL_OPTIONS: readonly DesktopModelOption[] = [];

type SessionDeletionState =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly sessionId: SessionId };

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

  const options = { replace: message.id, running: "stop", expect: revision } as const;

  const receipt = await connection()
    .session(sessionId)
    .send(
      content,
      choice.model === undefined
        ? options
        : {
            ...options,
            configuration: modelConfiguration(
              modelRefFor(choice.model, choice.fast),
              choice.thinkingLevel,
            ),
          },
    );

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

/**
 * The scrollport arrives as state, so everything below it re-runs on the
 * commit that creates the node, not one commit late. Rows walk the
 * transcript, so they are keyed on the durable inputs: a streaming frame
 * re-renders this and must not repeat them. A turn that ends in a step group
 * already draws the run's indicator there; one that ends in prose needs it
 * below the prose, or the model looks idle while it prepares its next step. A
 * subagent card always opens the tray, whatever the child's state; the tray's
 * own expand action is the way to a full chat.
 */
export function SessionConversation(conversation: SessionConversationProps): ReactElement {
  const { paneId, presentation, sessionId } = conversation;
  const host = useHostState();
  const paneActions = usePaneActions();
  const { layout } = usePaneControllerSnapshot();
  const session = useSession(sessionId);
  const catalog = useCatalog(sessionId);
  const children = useChildSessions(sessionId);
  const renameSession = useRenameSession();
  const sessionActions = useSessionActions();
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

  const { value: view, error: viewError, retry: retryView } = useSessionState(sessionId);
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

  const lastTurn = turns.at(-1);

  const settledWork = useMemo(
    () =>
      lastTurn !== undefined && displayTranscriptParts(lastTurn.messages).at(-1)?.kind === "step",
    [lastTurn],
  );

  const retrying = view?.execution.kind === "retrying" ? view.execution.reason : undefined;

  const rows = useMemo(
    () =>
      transcriptRows({
        loading: view === undefined && viewError === undefined,
        failed: viewError !== undefined,
        turns,
        landing: messages.submitted,
        held: messages.held,
        retrying,
        working,
        running: messages.running,
      }),
    [
      view,
      viewError,
      turns,
      messages.submitted,
      messages.held,
      messages.running,
      retrying,
      working,
    ],
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

  return (
    <SubagentSessionsProvider value={subagentSessions}>
      <div
        {...props(threadStyles.screen, presentation === "tray" && threadStyles.embeddedScreen)}
        aria-busy={view === undefined && viewError === undefined}
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
                onRetry={retryView}
              />

              {presentation === "full" && (
                <Composer
                  sessionId={sessionId}
                  floatingMount={conversation.floatingMount}
                  backgroundWork={{
                    content: (
                      <>
                        <QuestionTray
                          disabled={viewError !== undefined || navigating}
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
              sessionActions.delete(targetSessionId, hideFromPanes);
            }}
          />
        )}
      </div>
    </SubagentSessionsProvider>
  );
}
