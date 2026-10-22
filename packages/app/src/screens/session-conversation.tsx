import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { modelConfiguration } from "./model-configuration.ts";
import { PaneHeader } from "./pane-header.tsx";
import { props } from "@stylexjs/stylex";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Revision, SessionId, SessionView, UserContent } from "@nyte-ai/sdk";
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
  useWatchSelect,
} from "../sdk.tsx";
import type { WatchStore } from "../sdk.tsx";
import type { DesktopModelOption } from "../catalog.ts";

import { BackgroundWork } from "../conversation/tray/terminals.tsx";
import { Timeline } from "../conversation/timeline.tsx";
import { TranscriptProvider, useTranscriptControls } from "../conversation/transcript.tsx";
import { ApprovalTray } from "../conversation/approval-tray.tsx";
import { QuestionTray } from "../conversation/tray/questions.tsx";
import { transcriptProjector } from "../conversation/transcript-rows.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { workbenchController, workbenchViewKey } from "../workbench/controller.ts";
import { openJobTerminal } from "../workbench/terminal-store.ts";
import { SubagentTray, type SubagentTrayView } from "../conversation/tray/agents.tsx";
import { subagentSessions, SubagentSessionsProvider } from "../conversation/subagent-sessions.ts";
import { modelRefFor, selectedModelOption } from "../conversation/model-picker-state.ts";
import { useReleaseStartupReads } from "../startup.ts";
import { useMountEffect } from "../use-mount-effect.ts";
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

/** Waits until the watched view reaches the host's current sequence. A failed read ends the wait. */
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

function ComposerPaging({ column }: { readonly column: HTMLElement | null }): null {
  const controls = useTranscriptControls();

  useLayoutEffect(() => {
    if (column === null) return undefined;

    const page = (event: KeyboardEvent): void => {
      if (
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

    return () => column.removeEventListener("keydown", page);
  }, [column, controls]);

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

  const subagentTray: SubagentTrayView =
    trayView.kind === "terminals" ? { kind: "closed" } : trayView;

  const detailSessionId = subagentTray.kind === "detail" ? subagentTray.sessionId : undefined;
  const shownDetailSessionId = useDeferredValue(detailSessionId);

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

  const store = sessionWatch(sessionId);
  const [projector] = useState(transcriptProjector);
  const ready = useWatchSelect(store, (state) => state.value !== undefined);
  const failed = useWatchSelect(store, (state) => state.error !== undefined);
  const execution = useWatchSelect(store, (state) => state.value?.execution);
  const activation = useWatchSelect(store, (state) => state.value?.activation);
  const messages = useWatchSelect(store, projector.messages);
  const choice = useSessionChoice(sessionId);
  useReleaseStartupReads((ready && sessionName !== undefined) || failed);

  const viewStore = usePaneViewStateStore();
  useLayoutEffect(() => {
    if (activation !== undefined && presentation === "full") observeActivation(activation);
  }, [activation, presentation]);
  useMountEffect(() => childrenWatch(sessionId).subscribe(() => undefined));
  const working = navigating || messages.working;
  const cwd = host.data.workspace?.path;

  const loadEarlier = useCallback(() => loadEarlierMessages(sessionId, HISTORY_PAGE), [sessionId]);

  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);

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

  const editUserMessage = useCallback(
    async (message: UserMessage, content: UserContent, edit: BranchModelChoice): Promise<void> => {
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
    },
    [sessionId, store],
  );

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

  const subagents = useMemo(
    () => subagentSessions(sessionId, openSubagentTray),
    [openSubagentTray, sessionId],
  );

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
          <div ref={setColumn} {...props(sessionScreenStyles.conversation)}>
            <TranscriptProvider
              paneId={paneId}
              sessionId={sessionId}
              viewportRef={setScroll}
              loadEarlier={loadEarlier}
            >
              {presentation === "full" && <ComposerPaging column={column} />}
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
                            detailSessionId !== undefined &&
                            detailSessionId === shownDetailSessionId ? (
                              <SessionConversation
                                key={detailSessionId}
                                presentation="tray"
                                paneId={paneId}
                                sessionId={detailSessionId}
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
