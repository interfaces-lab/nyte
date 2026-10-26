import { mainHead, type UserMessage } from "@nyte-ai/plugin/client/presentation";
import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { modelConfiguration } from "./model-configuration.ts";
import { PaneHeader } from "./pane-header.tsx";
import { props } from "@stylexjs/stylex";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { useDeferredValue, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type {
  Activation,
  CommitId,
  Revision,
  SessionId,
  SessionView,
  UserContent,
} from "@nyte-ai/sdk";
import { Composer } from "../conversation/composer.tsx";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import type { BranchModelChoice, BranchModelPicker } from "../conversation/turn-view.tsx";
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
} from "../queries.ts";
import {
  childrenWatch,
  connection,
  loadEarlierMessages,
  sessionWatch,
  showTranscript,
  useWatchSelect,
} from "../sdk.tsx";
import type { WatchStore } from "../sdk.tsx";
import type { DesktopModelOption } from "../catalog.ts";

import { BackgroundWork, useHasLiveTerminals } from "../conversation/tray/terminals.tsx";
import { Timeline } from "../conversation/timeline.tsx";
import { TranscriptProvider, useTranscriptControls } from "../conversation/transcript.tsx";
import { ApprovalTray } from "../conversation/approval-tray.tsx";
import { QuestionTray } from "../conversation/tray/questions.tsx";
import { transcriptProjector } from "../conversation/transcript-rows.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import {
  workbenchController,
  workbenchShowsChat,
  workbenchViewKey,
} from "../workbench/controller.ts";
import type { WorkbenchViewKey } from "../workbench/controller.ts";
import { openJobTerminal } from "../workbench/terminal-store.ts";
import {
  listSubagents,
  SubagentTray,
  type SubagentTrayView,
} from "../conversation/tray/agents.tsx";
import { subagentSessions, SubagentSessionsProvider } from "../conversation/subagent-sessions.ts";
import { modelRefFor, selectedModelOption } from "../conversation/model-picker-state.ts";
import { StartupReadsRelease } from "../startup.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useCommitCount } from "../work-counts.ts";

const EMPTY_MODEL_OPTIONS: readonly DesktopModelOption[] = [];

const HISTORY_PAGE = 200;

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

  const session = connection().session(sessionId);

  if (choice.model !== undefined) {
    const configured = await session.configure(
      modelConfiguration(modelRefFor(choice.model, choice.fast), choice.thinkingLevel),
    );

    if (configured.kind !== "configured")
      throw new Error("That model setting is no longer available");
  }

  const receipt = await session.send(content, {
    replace: message.id,
    running: "stop",
    expect: revision,
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

async function awaitCurrentView(
  sessionId: SessionId,
  store: WatchStore<SessionView>,
): Promise<void> {
  const { seq } = await connection().session(sessionId).view({ tail: 0 });

  for (;;) {
    const { value, error } = store.getState();

    if (error !== undefined || (value !== undefined && value.seq >= seq)) return;
    await store.next();
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

function RunAnnouncer({ working }: { readonly working: boolean }): ReactElement {
  const [shown, setShown] = useState(working);
  const [message, setMessage] = useState("");

  if (working !== shown) {
    setShown(working);
    setMessage(working ? "Nyte is responding" : "Response finished");
  }

  return (
    <div role="status" {...props(srOnly)}>
      {message}
    </div>
  );
}

function TranscriptColumn({
  paging,
  onColumn,
  children,
}: {
  readonly paging: boolean;
  readonly onColumn: (column: HTMLDivElement | null) => void;
  readonly children: ReactNode;
}): ReactElement {
  const controls = useTranscriptControls();

  const attach = (column: HTMLDivElement): (() => void) => {
    onColumn(column);

    const page = (event: KeyboardEvent): void => {
      if (
        !paging ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "PageUp" && event.key !== "PageDown") ||
        !(event.target instanceof Element) ||
        event.target.closest("[data-composer-frame]") === null
      )
        return;
      event.preventDefault();
      controls.page(event.key === "PageDown" ? 1 : -1);
    };

    column.addEventListener("keydown", page);

    return () => {
      column.removeEventListener("keydown", page);
      onColumn(null);
    };
  };

  return (
    <div ref={attach} {...props(sessionScreenStyles.conversation)}>
      {children}
    </div>
  );
}

function ActivationNotice({ activation }: { readonly activation: Activation }): null {
  useMountEffect(() => observeActivation(activation));

  return null;
}

function subscribeAttention(notice: () => void): () => void {
  window.addEventListener("focus", notice);
  window.addEventListener("blur", notice);
  document.addEventListener("visibilitychange", notice);

  return () => {
    window.removeEventListener("focus", notice);
    window.removeEventListener("blur", notice);
    document.removeEventListener("visibilitychange", notice);
  };
}

function MarkSeen({
  sessionId,
  store,
  viewKey,
}: {
  readonly sessionId: SessionId;
  readonly store: WatchStore<SessionView>;
  readonly viewKey: WorkbenchViewKey;
}): ReactElement | null {
  const tip = useWatchSelect(store, ({ value }) => {
    const drawn = value === undefined ? undefined : mainHead(value)?.tip;

    return drawn?.kind === "commit" ? drawn.id : undefined;
  });

  const looking = useSyncExternalStore(
    subscribeAttention,
    () => document.visibilityState === "visible" && document.hasFocus(),
  );

  const covered = useSyncExternalStore(workbenchController.subscribe, () => {
    const view = workbenchController.getView(viewKey);

    return view.expanded && view.layout.kind === "maximized" && !workbenchShowsChat(view.layout);
  });

  return tip === undefined || !looking || covered ? null : (
    <SeeTip key={tip} sessionId={sessionId} tip={tip} />
  );
}

function SeeTip({
  sessionId,
  tip,
}: {
  readonly sessionId: SessionId;
  readonly tip: CommitId;
}): null {
  useMountEffect(() => {
    void connection()
      .session(sessionId)
      .see(tip)
      .catch(() => undefined);
  });

  return null;
}

export function SessionConversation(conversation: SessionConversationProps): ReactElement {
  useCommitCount("render:conversation");
  const { paneId, presentation, sessionId } = conversation;
  const host = useHostState();
  const paneActions = usePaneActions();
  const { layout } = usePaneControllerSnapshot();
  const sessionName = useSession(sessionId, (session) => session.name).data;
  const catalog = useCatalog(sessionId);
  const renameSession = useRenameSession();
  const sessionActions = useSessionActions();
  const [draftName, setDraftName] = useState<string | undefined>();
  const [deletion, setDeletion] = useState<SessionDeletionState>({ kind: "closed" });
  const [navigating, setNavigating] = useState(false);

  const [trayView, setTrayView] = useState<SubagentTrayView | { readonly kind: "terminals" }>({
    kind: "closed",
  });

  const hasTerminals = useHasLiveTerminals(presentation === "full" ? sessionId : undefined);
  const childSessions = useChildSessions(sessionId).data ?? [];

  const trayEmptied =
    (trayView.kind === "terminals" && !hasTerminals) ||
    (trayView.kind === "list" && listSubagents(childSessions, trayView).listed.length === 0);

  if (trayEmptied) setTrayView({ kind: "closed" });

  const deferredTrayView = useDeferredValue(trayView);
  const shownTrayView = trayView.kind === "detail" ? deferredTrayView : trayView;

  const subagentTray: SubagentTrayView =
    shownTrayView.kind === "terminals" ? { kind: "closed" } : shownTrayView;

  const paneMenuTrigger = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<ComposerEditorHandle | null>(null);
  const inputRef = presentation === "full" ? conversation.inputRef : undefined;

  const attachComposer = (handle: ComposerEditorHandle | null): void => {
    composerRef.current = handle;
    inputRef?.(handle);
  };

  const store = sessionWatch(sessionId);
  const [projector] = useState(transcriptProjector);
  const ready = useWatchSelect(store, (state) => state.value !== undefined);
  const failed = useWatchSelect(store, (state) => state.error !== undefined);
  const execution = useWatchSelect(store, (state) => state.value?.execution);
  const activation = useWatchSelect(store, (state) => state.value?.activation);
  const messages = useWatchSelect(store, projector.messages);
  const choice = useSessionChoice(sessionId);

  const viewStore = usePaneViewStateStore();
  useMountEffect(() => childrenWatch(sessionId).subscribe(() => undefined));
  useMountEffect(() => showTranscript(sessionId));
  const working = navigating || messages.working;
  const cwd = host.data.workspace?.path;

  const loadEarlier = () => loadEarlierMessages(sessionId, HISTORY_PAGE);

  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);

  const modelOptions = catalog.data?.models ?? EMPTY_MODEL_OPTIONS;

  const configuredModel = choice?.model;
  const thinkingLevel = choice?.thinking;

  const selected = selectedModelOption(modelOptions, configuredModel);

  const branchModel: BranchModelPicker = {
    catalog: catalog.data,
    model: selected?.option,
    thinkingLevel,
    fast: selected?.fast === true,
  };

  const title = sessionName ?? "New chat";

  const commitRename = (): void => {
    if (draftName === undefined) return;
    const name = draftName.replaceAll(/\s+/g, " ").trim();
    setDraftName(undefined);

    if (name !== "" && name !== title) renameSession.mutate({ sessionId, name });
  };

  const requestDelete = (): void => {
    setDeletion({ kind: "open", sessionId });
  };

  const editUserMessage = async (
    message: UserMessage,
    content: UserContent,
    edit: BranchModelChoice,
  ): Promise<void> => {
    setNavigating(true);

    return applyMessageEdit({
      sessionId,
      message,
      revision: store.getState().value?.revision,
      content,
      choice: edit,
    })
      .then(() => awaitCurrentView(sessionId, store).catch(() => undefined))
      .finally(() => setNavigating(false));
  };

  const forwardSubagentTray = presentation === "tray" ? conversation.onOpenSubagentTray : undefined;

  const openSubagentTray = (childSessionId: SessionId): void => {
    if (forwardSubagentTray !== undefined) {
      forwardSubagentTray(childSessionId);

      return;
    }

    setTrayView({ kind: "detail", sessionId: childSessionId });
  };

  const subagents = subagentSessions(sessionId, openSubagentTray);

  return (
    <SubagentSessionsProvider value={subagents}>
      <div
        {...props(
          sessionScreenStyles.screen,
          presentation === "full"
            ? sessionScreenStyles.paneScreen
            : sessionScreenStyles.embeddedScreen,
        )}
        aria-busy={!ready && !failed}
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
                  xstyle={sessionScreenStyles.renameInput}
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

        <div {...props(sessionScreenStyles.body)}>
          <TranscriptProvider
            paneId={paneId}
            sessionId={sessionId}
            viewportRef={setScroll}
            loadEarlier={loadEarlier}
          >
            <TranscriptColumn paging={presentation === "full"} onColumn={setColumn}>
              <MarkSeen sessionId={sessionId} store={store} viewKey={workbenchViewKey(cwd)} />
              {((ready && sessionName !== undefined) || failed) && <StartupReadsRelease />}
              {presentation === "full" && activation !== undefined && (
                <ActivationNotice key={JSON.stringify(activation)} activation={activation} />
              )}
              {presentation === "full" && <RunAnnouncer working={working} />}
              <Timeline
                store={store}
                projector={projector}
                ready={ready}
                navigating={navigating}
                cwd={cwd}
                branchModel={branchModel}
                onEditUser={editUserMessage}
                onRetry={store.retry}
              />

              {presentation === "full" && (
                <Composer
                  sessionId={sessionId}
                  floatingMount={conversation.floatingMount}
                  backgroundWork={{
                    content: (
                      <>
                        <ApprovalTray
                          sessionId={sessionId}
                          disabled={failed || navigating}
                          viewport={scroll}
                        />
                        <QuestionTray disabled={failed || navigating} viewport={scroll} />
                        <SubagentTray
                          parentSessionId={sessionId}
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
                          open={shownTrayView.kind === "terminals"}
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
                  execution={execution}
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
            </TranscriptColumn>
          </TranscriptProvider>
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
