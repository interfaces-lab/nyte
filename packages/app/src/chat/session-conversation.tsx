import { runStatus, type UserMessage } from "@nyte-ai/plugin/client/presentation";
import type { RunStatus } from "@nyte-ai/plugin/client/presentation";
import { sessionScreenStyles } from "../panes/session-screen.stylex.ts";
import { modelConfiguration } from "../panes/model-configuration.ts";
import { PaneHeader } from "../panes/pane-header.tsx";
import { props } from "@stylexjs/stylex";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { useDeferredValue, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Activation, Revision, SessionId, SessionView, UserContent } from "@nyte-ai/sdk";
import { Composer } from "./composer/composer.tsx";
import type { ComposerEditorHandle } from "./composer/composer-editor.tsx";
import type { BranchModelChoice, BranchModelPicker } from "./transcript/turn-view.tsx";
import { observeActivation } from "../panes/open-workspace.tsx";
import { Input } from "@nyte-ai/ui/input";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import {
  hideFromPanes,
  usePaneControllerSnapshot,
  usePaneViewStateStore,
} from "../panes/pane-context.tsx";
import { activePane } from "../panes/pane-layout.ts";
import type { PaneId } from "../panes/pane-layout.ts";
import { useCatalog } from "../data/catalog.ts";
import { useRenameSession, useSessionChoice } from "../data/sessions.ts";
import { useSessionActions } from "../data/session-actions.ts";
import { useHostState } from "../data/host.ts";
import { loadEarlierMessages, sessionWatch } from "../data/watches.ts";
import { connection } from "../data/connection.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import type { WatchStore } from "../data/watch-store.ts";
import type { DesktopModelOption } from "../data/catalog.ts";

import { BackgroundWork, listTerminals } from "./trays/terminals.tsx";
import { Timeline } from "./transcript/timeline.tsx";
import { TranscriptProvider, useTranscriptControls } from "./transcript/transcript.tsx";
import { ApprovalTray } from "./trays/approval-tray.tsx";
import { QuestionTray } from "./trays/questions.tsx";
import { transcriptProjector } from "./transcript/transcript-rows.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { listAgents, SubagentTray, type SubagentTrayView } from "./trays/agents.tsx";
import { modelRefFor, selectedModelOption } from "./composer/model-picker-state.ts";
import { StartupReadsRelease } from "../data/startup.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useCommitCount } from "../lib/work-counts.ts";
import { chatTitle, useChat, useChats, useChatTasks } from "../chats/index.ts";
import { chatWindow, showTray, useChatWindow } from "../window/index.ts";
import type { TrayView } from "../window/index.ts";

const EMPTY_MODEL_OPTIONS: readonly DesktopModelOption[] = [];

const CLOSED_TRAY: TrayView = { kind: "closed" };

const NONE_CLEARED: ReadonlySet<string> = new Set();

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
    };

const ANNOUNCEMENTS = {
  idle: "",
  working: "Nyte is responding",
  retrying: "Nyte is responding",
  "waiting-for-approval": "Nyte needs your answer",
  completed: "Response finished",
  stopped: "Response stopped",
  failed: "Response failed",
} as const satisfies Readonly<Record<RunStatus["kind"], string>>;

/** Says when the chat's run starts, needs an answer or ends, and how it ended. */
function RunAnnouncer({ status }: { readonly status: RunStatus }): ReactElement {
  const announcement = ANNOUNCEMENTS[status.kind];
  const [shown, setShown] = useState(announcement);
  const [message, setMessage] = useState("");

  if (announcement !== shown) {
    setShown(announcement);
    setMessage(announcement);
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

/** Marks the chat read through each new tip while the user is looking at it. */
function MarkSeen({ sessionId }: { readonly sessionId: SessionId }): ReactElement | null {
  const tip = useChats((chats) => chats.get(sessionId)?.unreadTip?.commit);
  const looking = useChatWindow((snapshot) => snapshot.looking.has(sessionId));

  return tip === undefined || !looking ? null : <SeeTip key={tip} sessionId={sessionId} />;
}

function SeeTip({ sessionId }: { readonly sessionId: SessionId }): null {
  useMountEffect(() => {
    void chatWindow.markRead([sessionId]);
  });

  return null;
}

export function SessionConversation(conversation: SessionConversationProps): ReactElement {
  useCommitCount("render:conversation");
  const { paneId, presentation, sessionId } = conversation;
  const host = useHostState();
  const { layout } = usePaneControllerSnapshot();
  const chat = useChat(sessionId);
  const catalog = useCatalog(sessionId);
  const renameSession = useRenameSession();
  const sessionActions = useSessionActions();
  const [draftName, setDraftName] = useState<string | undefined>();
  const [deletion, setDeletion] = useState<SessionDeletionState>({ kind: "closed" });
  const [navigating, setNavigating] = useState(false);

  const kept = useChatWindow((snapshot) =>
    presentation === "full" ? (snapshot.trays.get(sessionId) ?? CLOSED_TRAY) : CLOSED_TRAY,
  );

  const setTrayView = (view: TrayView): void =>
    chatWindow.act({ kind: "tray", parent: sessionId, view });

  const tasks = useChatTasks(presentation === "full" ? sessionId : undefined);
  const cleared = useChatWindow((snapshot) => snapshot.cleared.get(sessionId) ?? NONE_CLEARED);
  const agents = listAgents(tasks, cleared);
  const terminals = listTerminals(tasks, cleared);

  const trayView = showTray(kept, {
    agents: agents.map((agent) => agent.id),
    terminals: terminals.map((terminal) => terminal.id),
  });

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
  const status = runStatus(useWatchSelect(store, (state) => state.value?.execution));
  const activation = useWatchSelect(store, (state) => state.value?.activation);
  const messages = useWatchSelect(store, projector.messages);
  const choice = useSessionChoice(sessionId);

  const viewStore = usePaneViewStateStore();
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

  const title = chatTitle(chat.kind === "ready" ? chat.chat : undefined);

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

  return (
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
          focusComposer={() => composerRef.current?.focus({ preventScroll: true })}
        >
          <TranscriptColumn paging={presentation === "full"} onColumn={setColumn}>
            <MarkSeen sessionId={sessionId} />
            {((ready && chat.kind !== "loading") || failed) && <StartupReadsRelease />}
            {presentation === "full" && activation !== undefined && (
              <ActivationNotice key={JSON.stringify(activation)} activation={activation} />
            )}
            {presentation === "full" && <RunAnnouncer status={status} />}
            <Timeline
              sessionId={sessionId}
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
                active={activePane(layout).id === paneId}
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
                        agents={agents}
                        view={subagentTray}
                        onViewChange={setTrayView}
                        onRelease={() => composerRef.current?.focus({ preventScroll: true })}
                        viewport={scroll}
                        detail={
                          subagentTray.kind === "detail" ? (
                            <SessionConversation
                              key={subagentTray.sessionId}
                              presentation="tray"
                              paneId={paneId}
                              sessionId={subagentTray.sessionId}
                            />
                          ) : null
                        }
                      />
                      <BackgroundWork
                        sessionId={sessionId}
                        terminals={terminals}
                        open={shownTrayView.kind === "terminals"}
                        onViewChange={setTrayView}
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
                status={status}
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
  );
}
