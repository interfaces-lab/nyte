/**
 * The persistent desktop stage. Pane hosts are keyed only by PaneId; selecting
 * another session changes a host's data binding without replacing its DOM or
 * its view-state owner.
 */
import * as stylex from "@stylexjs/stylex";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { CSSProperties, PointerEvent, ReactElement, ReactNode, RefObject } from "react";
import type { SessionId, ThinkingLevel, Turn, UserTurnPart } from "@nyte-ai/core";
import type { DesktopVcsSnapshot } from "../../../shared/ipc.ts";
import {
  Composer,
  ComposerFrame,
  composerMessageContent,
  composerPromptText,
  composerSource,
  readComposerImageAttachments,
} from "../conversation/composer.tsx";
import type { ComposerChip, ComposerImageAttachment } from "../conversation/composer.tsx";
import type { BranchModelChoice, BranchModelPicker } from "../conversation/turn-view.tsx";
import { ModelPicker, type ModelPickerChange } from "../conversation/model-picker.tsx";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { Icon } from "../components/icons.tsx";
import { Menu, MenuItem, MenuSeparator } from "../components/menu.tsx";
import { focus, IconButton } from "../components/ui.tsx";
import { handleOpenOutcome } from "../chrome/open-workspace.tsx";
import {
  usePaneActions,
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
import type { BlankViewState, SessionViewState } from "../layout/session-view-state.ts";
import { livePartKey, useSessionLive } from "../live.ts";
import type { LiveSnapshot } from "../live.ts";
import {
  keys,
  loadThread,
  queryClient,
  useCatalog,
  useDeleteSession,
  useHostState,
  useMentionFiles,
  usePluginCatalog,
  usePluginSettings,
  useRenameSession,
  useSession,
  useSessionSnapshot,
  useVcsSnapshot,
  useWorkspaces,
} from "../queries.ts";
import { macPlatform } from "../platform.ts";
import { sessionWorking } from "../run-state.ts";
import { outbox } from "../use-outbox.ts";
import { conversation, layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { nyte } from "../nyte.ts";
import type { DesktopModelOption } from "../nyte.ts";

const Prose = lazy(() =>
  import("../conversation/prose.tsx").then((module) => ({ default: module.Prose })),
);
const TurnView = lazy(() =>
  import("../conversation/turn-view.tsx").then((module) => ({ default: module.TurnView })),
);
const WorkGroupView = lazy(() =>
  import("../conversation/tool-group.tsx").then((module) => ({ default: module.WorkGroupView })),
);
const ConfirmDialog = lazy(() =>
  import("../components/confirm-dialog.tsx").then((module) => ({
    default: module.ConfirmDialog,
  })),
);
import { WORKBENCH_STAGE_PANE_KEY } from "../workbench/controller.ts";
import type { WorkbenchTarget } from "../workbench/controller.ts";
import { Workbench } from "../workbench/workbench.tsx";

const styles = stylex.create({
  stage: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  panes: {
    position: "relative",
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  splitRight: { flexDirection: "row" },
  splitDown: { flexDirection: "column" },
  pane: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: t.bgBase,
  },
  paneSingle: { flex: 1 },
  paneLeading: (ratio: number) => ({
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: `${String(ratio * 100)}%`,
  }),
  paneTrailing: { flex: 1 },
  screen: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: conversation.headerHeight,
    paddingInline: 12,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: t.fontBase,
    fontWeight: 600,
    color: t.textPrimary,
  },
  headerActions: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  renameInput: {
    flex: 1,
    minWidth: 0,
    height: 24,
    paddingInline: 6,
    borderRadius: t.radiusSm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: t.borderWeak, ":focus-visible": t.strokeFocused },
    backgroundColor: t.bgElevated,
    color: t.textPrimary,
    fontSize: t.fontBase,
    fontWeight: 600,
    outline: "none",
  },
  body: { position: "relative", display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  conversation: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.turnGap,
    width: `min(${conversation.measure}, 100%)`,
    marginInline: "auto",
    paddingInline: conversation.gutter,
    paddingTop: 16,
    paddingBottom: 18,
  },
  banner: {
    width: "fit-content",
    padding: "5px 10px",
    borderRadius: t.radiusLg,
    backgroundColor: t.fillWarningSubtle,
    color: t.textWarning,
    fontSize: t.fontSm,
  },
  bannerAction: {
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: "inherit",
    textDecorationLine: "underline",
    cursor: "pointer",
  },
  loading: { color: t.textTertiary, fontSize: t.fontSm },
  liveTurn: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    width: "100%",
    minWidth: 0,
  },
  blank: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    minHeight: 0,
  },
  blankColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: "min(608px, calc(100% - 40px))",
  },
  greeting: { paddingInlineStart: 4, color: t.textTertiary, fontSize: t.fontLg },
  workspaceContext: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
    paddingInline: 4,
    color: t.textSecondary,
    fontSize: t.fontBase,
  },
  workspaceContextItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  workspaceContextButton: {
    height: 26,
    paddingInline: 5,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
      "[data-popup-open]": t.fillGhostSelected,
    },
    color: "inherit",
    cursor: "pointer",
  },
  workspaceContextPath: { maxWidth: 280 },
  workspaceContextStatic: { height: 26, paddingInline: 5 },
  workspaceContextText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  blankHint: { paddingInlineStart: 4, color: t.textTertiary, fontSize: t.fontBase },
  blankActions: { display: "flex", gap: 8, paddingInlineStart: 4 },
  error: { paddingInlineStart: 4, color: t.textDanger, fontSize: t.fontBase },
  sash: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    zIndex: 4,
    touchAction: "none",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineColor: t.strokeFocused,
    outlineOffset: -2,
  },
  sashRight: { width: 9, cursor: "col-resize" },
  sashDown: { height: 9, cursor: "row-resize" },
  sashLine: { backgroundColor: t.strokeTertiary, pointerEvents: "none" },
  sashLineRight: { width: 1, height: "100%" },
  sashLineDown: { width: "100%", height: 1 },
  dropPreviewLayer: {
    position: "absolute",
    inset: 2,
    zIndex: layer.dragPreview,
    overflow: "hidden",
    pointerEvents: "none",
  },
  dropPreview: {
    position: "absolute",
    borderRadius: t.radiusSm,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: t.fillAccent,
    backgroundColor: `color-mix(in srgb, ${t.fillAccent} 8%, transparent)`,
    pointerEvents: "none",
  },
});

const EMPTY_TURNS: readonly Turn[] = [];
const STICKY_MESSAGE_ACTIVATION_EPSILON = 2;

function setDataState(element: HTMLElement, name: string, active: boolean): void {
  const value = active ? "true" : "false";
  if (element.dataset[name] !== value) element.dataset[name] = value;
}

/**
 * Cursor keeps the real user row sticky inside its turn boundary. Mutating a
 * data state here avoids cloning the prompt or rerendering the transcript on
 * every scroll tick; React continues to own the row and its edit state.
 */
function syncStickyUserMessage(scroll: HTMLDivElement, transcript: HTMLDivElement): void {
  const viewportTop = scroll.getBoundingClientRect().top;
  let active: HTMLElement | undefined;
  const rows = transcript.querySelectorAll<HTMLElement>("[data-sticky-user-message]");

  for (const row of rows) {
    const turn = row.closest<HTMLElement>("[data-sticky-turn='true']");
    const eligible = turn !== null && row.offsetHeight < scroll.clientHeight;
    setDataState(row, "stickyDisabled", !eligible);
    if (!eligible || turn === null) continue;

    const sourceTop = turn.getBoundingClientRect().top - viewportTop + scroll.scrollTop;
    if (sourceTop <= scroll.scrollTop + STICKY_MESSAGE_ACTIVATION_EPSILON) active = row;
  }

  for (const row of rows) {
    const selected = row === active;
    setDataState(row, "stickyActive", selected);
    const fade = row.querySelector<HTMLElement>("[data-sticky-message-fade]");
    if (fade !== null) setDataState(fade, "stickyVisible", selected);
  }
}

function repositoryBranch(snapshot: DesktopVcsSnapshot | undefined): string | undefined {
  if (snapshot === undefined) return undefined;
  switch (snapshot.kind) {
    case "not_repository":
      return undefined;
    case "repository":
      return snapshot.status.branch;
    default: {
      const _exhaustive: never = snapshot;
      return _exhaustive;
    }
  }
}

function displayWorkspacePath(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~").replace(/^\/home\/[^/]+(?=\/|$)/, "~");
}

function LiveTurn({
  live,
  working,
  settledWork,
  cwd,
}: {
  live: LiveSnapshot;
  working: boolean;
  settledWork: boolean;
  cwd: string | undefined;
}): ReactElement | null {
  const appearance = useAppearanceSettings();
  const textParts = live.order.filter((ref) => ref.kind === "text");
  const hasText = textParts.length > 0;
  const hasLiveWork =
    live.order.some((ref) => ref.kind === "thinking") ||
    live.tools.size > 0 ||
    (!hasText && working);
  const busy = live.runState !== "idle" || working;
  if (!hasText && !hasLiveWork && !busy) return null;

  return (
    <div {...stylex.props(styles.liveTurn)}>
      {!settledWork && hasLiveWork && (
        <WorkGroupView
          parts={[]}
          live={live}
          liveTools={live.tools}
          cwd={cwd}
          durationMs={0}
          running={busy}
          density={appearance.toolCalls}
        />
      )}
      {textParts.map((ref) => {
        const key = livePartKey(ref.runId, ref.attempt, ref.index);
        const text = live.text.get(key) ?? "";
        return text === "" ? null : <Prose key={`text:${key}`} markdown={text} streaming />;
      })}
    </div>
  );
}

type SessionViewUpdate = (current: SessionViewState) => SessionViewState;
type BlankViewUpdate = (current: BlankViewState) => BlankViewState;
type SessionDeletionState =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly sessionId: SessionId };

function useSessionViewBinding(
  sessionId: SessionId,
  paneId: PaneId,
): readonly [SessionViewState, (update: SessionViewUpdate) => void] {
  const store = usePaneViewStateStore();
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const state = store.readSession(sessionId, paneId);
  const update = useCallback(
    (change: SessionViewUpdate): void => {
      store.updateSession(sessionId, paneId, change);
      redraw();
    },
    [paneId, sessionId, store],
  );
  return [state, update];
}

function useBlankViewBinding(
  paneId: PaneId,
): readonly [BlankViewState, (update: BlankViewUpdate) => void] {
  const store = usePaneViewStateStore();
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const state = store.readBlank(paneId);
  const update = useCallback(
    (change: BlankViewUpdate): void => {
      store.writeBlank(paneId, change(store.readBlank(paneId)));
      redraw();
    },
    [paneId, store],
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
  const { layout } = usePaneControllerSnapshot();
  const host = useHostState();
  const canSplit = layout.kind === "single";
  const mac = macPlatform(host.data?.platform);
  const modifier = mac ? "⌘" : "Ctrl+";
  const shift = mac ? "⇧" : "Shift+";

  return (
    <div {...stylex.props(styles.header)}>
      <span {...stylex.props(styles.title)}>{title}</span>
      <span {...stylex.props(styles.headerActions)}>
        <Menu
          label="Pane actions"
          align="end"
          trigger={<IconButton ref={menuTriggerRef} icon="more" label="Pane actions" />}
        >
          <MenuItem
            icon="split-down"
            meta={`${shift}${modifier}D`}
            disabled={!canSplit}
            onSelect={() => actions.split("down")}
          >
            Split down
          </MenuItem>
          <MenuItem
            icon="split-right"
            meta={`${modifier}D`}
            disabled={!canSplit}
            onSelect={() => actions.split("right")}
          >
            Split right
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

function SessionConversation({
  paneId,
  sessionId,
  inputRef,
}: {
  paneId: PaneId;
  sessionId: SessionId;
  inputRef: (element: HTMLTextAreaElement | null) => void;
}): ReactElement {
  const host = useHostState();
  const panes = usePaneActions();
  const { layout } = usePaneControllerSnapshot();
  const session = useSession(sessionId);
  const catalog = useCatalog();
  const renameSession = useRenameSession();
  const deleteSession = useDeleteSession();
  const [draftName, setDraftName] = useState<string | undefined>();
  const [deletion, setDeletion] = useState<SessionDeletionState>({ kind: "closed" });
  const [navigating, setNavigating] = useState(false);
  const paneMenuTrigger = useRef<HTMLButtonElement>(null);
  const snapshot = useSessionSnapshot(sessionId);
  const turns = snapshot.data?.transcript ?? EMPTY_TURNS;
  const live = useSessionLive(sessionId, snapshot.data?.seq);
  const viewStore = usePaneViewStateStore();
  const [viewState, updateViewState] = useSessionViewBinding(sessionId, paneId);
  const working =
    navigating ||
    live.runState !== "idle" ||
    (snapshot.data !== undefined && sessionWorking(snapshot.data.session));
  const cwd = host.data?.workspace?.path;
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const ready = snapshot.data !== undefined;
  const modelOptions = catalog.data?.models ?? [];
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
  const branchModel: BranchModelPicker = {
    catalog: catalog.data,
    model: modelOptions.find(
      (option) =>
        option.id === configuredModel?.id &&
        (configuredModel.provider === undefined || option.provider === configuredModel.provider),
    ),
    thinkingLevel: snapshot.data?.config.thinkingLevel,
    fastEnabled,
  };
  const lastTurn = turns.at(-1);
  const settledWork =
    lastTurn?.kind === "turn" &&
    lastTurn.parts.some((part) => part.kind === "thinking" || part.kind === "tool");

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const transcript = transcriptRef.current;
    if (element === null || transcript === null) return undefined;
    const restored = viewStore.readSession(sessionId, paneId).scroll;
    element.scrollTop = restored.bottomPinned ? element.scrollHeight : restored.top;
    syncStickyUserMessage(element, transcript);
    // Streamed text, late highlights, and a shrinking scrollport all move the
    // bottom; a reader pinned there follows it.
    const observer = new ResizeObserver(() => {
      if (viewStore.readSession(sessionId, paneId).scroll.bottomPinned) {
        element.scrollTop = element.scrollHeight;
      }
      syncStickyUserMessage(element, transcript);
    });
    observer.observe(element);
    observer.observe(transcript);
    return () => observer.disconnect();
  }, [paneId, ready, sessionId, viewStore]);

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
    deleteSession.reset();
    setDeletion({ kind: "open", sessionId });
  };

  const editUserMessage = useCallback(
    async (
      part: UserTurnPart,
      content: UserTurnPart["content"],
      choice: BranchModelChoice,
    ): Promise<void> => {
      setNavigating(true);
      try {
        const outcome = await nyte.heads.move({ sessionId, to: part.commit });
        switch (outcome.kind) {
          case "moved":
            if (outcome.restored?.commit !== part.commit) {
              throw new Error("The selected message is no longer editable.");
            }
            if (choice.model !== undefined) {
              const configured = await nyte.sessions.configure({
                sessionId,
                model: { provider: choice.model.provider, id: choice.model.id },
                ...(choice.thinkingLevel === undefined
                  ? {}
                  : { thinkingLevel: choice.thinkingLevel }),
              });
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
            await outbox.submitDurably({ sessionId, content });
            await loadThread(sessionId);
            void queryClient.invalidateQueries({ queryKey: keys.sessions });
            void queryClient.invalidateQueries({ queryKey: keys.pluginSettings(sessionId) });
            return;
          case "busy":
            throw new Error("Wait for the current response before editing this message.");
          case "moved_since":
          case "not_found":
            throw new Error("The selected message is no longer in this branch.");
          case "failed":
            throw new Error(outcome.message);
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      } finally {
        setNavigating(false);
      }
    },
    [fastEnabled, sessionId],
  );

  return (
    <div {...stylex.props(styles.screen)} aria-busy={snapshot.isLoading}>
      {layout.kind === "split" && (
        <PaneHeader
          paneId={paneId}
          menuTriggerRef={paneMenuTrigger}
          title={
            draftName === undefined ? (
              title
            ) : (
              <input
                aria-label="Chat name"
                autoFocus
                {...stylex.props(styles.renameInput)}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
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

      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.conversation)}>
          <div
            ref={scrollRef}
            data-nyte-scrollport="balanced"
            {...stylex.props(styles.scroll)}
            onScroll={(event) => {
              const element = event.currentTarget;
              const bottomPinned =
                element.scrollHeight - element.scrollTop - element.clientHeight < 60;
              viewStore.updateSession(sessionId, paneId, (current) => ({
                ...current,
                scroll: { top: element.scrollTop, bottomPinned },
              }));
              const transcript = transcriptRef.current;
              if (transcript !== null) syncStickyUserMessage(element, transcript);
            }}
          >
            <div ref={transcriptRef} {...stylex.props(styles.transcript)}>
              <Suspense
                fallback={
                  <div role="status" {...stylex.props(styles.loading)}>
                    Loading chat…
                  </div>
                }
              >
                {snapshot.isLoading && turns.length === 0 && (
                  <div role="status" {...stylex.props(styles.loading)}>
                    Loading chat…
                  </div>
                )}
                {snapshot.isError && (
                  <div role="alert" {...stylex.props(styles.banner)}>
                    Couldn&rsquo;t load this chat.{" "}
                    <button
                      type="button"
                      {...stylex.props(styles.bannerAction, focus.ring)}
                      onClick={() => void snapshot.refetch()}
                    >
                      Try again
                    </button>
                  </div>
                )}
                {turns.map((turn, index) => (
                  <TurnView
                    key={turn.kind === "turn" ? turn.id : `${turn.kind}:${turn.commit}`}
                    turn={turn}
                    liveTools={live.tools}
                    live={working && index === turns.length - 1 ? live : undefined}
                    cwd={cwd}
                    onEditUser={editUserMessage}
                    branchModel={branchModel}
                    running={working && index === turns.length - 1}
                  />
                ))}
                {live.runState === "retrying" && live.retry !== undefined && (
                  <div role="status" title={live.retry.message} {...stylex.props(styles.banner)}>
                    Retrying…
                  </div>
                )}
                <LiveTurn live={live} working={working} settledWork={settledWork} cwd={cwd} />
              </Suspense>
            </div>
          </div>

          <Composer
            sessionId={sessionId}
            working={working}
            pending={snapshot.data?.pending ?? []}
            disabled={snapshot.data === undefined || snapshot.isError}
            viewState={viewState.composer}
            onViewStateChange={(updateComposer) =>
              updateViewState((current) => ({
                ...current,
                composer: updateComposer(current.composer),
              }))
            }
            inputRef={inputRef}
            autoFocus={false}
          />
        </div>
      </div>
      {deletion.kind === "open" && (
        <Suspense fallback={null}>
          <ConfirmDialog
            open
            pending={deleteSession.isPending}
            error={deleteSession.isError ? "Couldn't delete this chat. Try again." : undefined}
            returnFocusRef={paneMenuTrigger}
            onOpenChange={(nextOpen) => {
              if (nextOpen) return;
              deleteSession.reset();
              setDeletion({ kind: "closed" });
            }}
            onConfirm={() => {
              const { sessionId: targetSessionId } = deletion;
              deleteSession.mutate(targetSessionId, {
                onSuccess: () => {
                  setDeletion({ kind: "closed" });
                  panes.removeSession(targetSessionId);
                },
              });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function BlankConversation({
  paneId,
  inputRef,
}: {
  paneId: PaneId;
  inputRef: (element: HTMLTextAreaElement | null) => void;
}): ReactElement {
  const host = useHostState();
  const { layout } = usePaneControllerSnapshot();
  const workspace = host.data?.workspace;
  const vcs = useVcsSnapshot(workspace !== undefined);
  const catalog = useCatalog();
  const pluginCatalog = usePluginCatalog();
  const workspaceFiles = useMentionFiles(workspace !== undefined);
  const workspaces = useWorkspaces();
  const actions = usePaneActions();
  const [viewState, updateViewState] = useBlankViewBinding(paneId);
  const [picked, setPicked] = useState<DesktopModelOption | undefined>();
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | undefined>();
  /** Fast-mode setting ids switched on for the session this composer will create. */
  const [fastSettings, setFastSettings] = useState<ReadonlySet<string>>(() => new Set());
  // The raw cause is diagnostic only: it rides in `title`, never in body copy.
  const [startFailure, setStartFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<readonly ComposerImageAttachment[]>([]);
  const [attachmentReads, setAttachmentReads] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const branch = workspace === undefined ? undefined : repositoryBranch(vcs.data);
  const recentWorkspaces = (workspaces.data ?? []).filter(
    (candidate) => candidate.path !== workspace?.path,
  );
  const defaults = catalog.data?.defaults;
  const current =
    picked ??
    catalog.data?.models.find(
      (option) => option.provider === defaults?.model.provider && option.id === defaults.model.id,
    );
  const effectiveThinkingLevel = thinkingLevel ?? defaults?.thinkingLevel;
  const handleModelPickerChange = useCallback((change: ModelPickerChange) => {
    switch (change.kind) {
      case "model":
        setPicked(change.option);
        setThinkingLevel(change.thinkingLevel);
        return;
      case "thinking":
        setThinkingLevel(change.thinkingLevel);
        return;
      case "fast":
        setFastSettings((settings) => {
          const next = new Set(settings);
          if (change.enabled) next.add(change.settingId);
          else next.delete(change.settingId);
          return next;
        });
        return;
      default: {
        const _exhaustive: never = change;
        return _exhaustive;
      }
    }
  }, []);

  const start = async (chips: readonly ComposerChip[]): Promise<boolean> => {
    const text = viewState.composer.draft.trim();
    const prompt = composerPromptText(text, chips);
    if ((prompt === "" && attachments.length === 0) || sending || attachmentReads !== 0) {
      return false;
    }
    const content = composerMessageContent(text, attachments, chips);
    setSending(true);
    setStartFailure(undefined);
    try {
      const session = await nyte.sessions.create();
      // Configure what the chip showed, picked or not: the host composed its
      // default before any login or Settings change made since.
      if (current !== undefined) {
        const model = { provider: current.provider, id: current.id };
        await nyte.sessions.configure(
          effectiveThinkingLevel === undefined
            ? { sessionId: session.sessionId, model }
            : { sessionId: session.sessionId, model, thinkingLevel: effectiveThinkingLevel },
        );
      }
      if (current?.fastMode.kind === "available" && fastSettings.has(current.fastMode.settingId)) {
        const outcome = await nyte.plugins.settings.apply({
          sessionId: session.sessionId,
          id: current.fastMode.settingId,
          choiceId: "on",
        });
        if (outcome.kind !== "applied") throw new Error("Fast mode is no longer available");
      }
      await outbox.submitDurably({ sessionId: session.sessionId, content });
      updateViewState(() => ({
        composer: { draft: "", selectionStart: 0, selectionEnd: 0, focused: false },
      }));
      setAttachments([]);
      setAttachmentError(undefined);
      void queryClient.invalidateQueries({ queryKey: keys.sessions });
      void loadThread(session.sessionId).catch(() => undefined);
      actions.openSessionInPane(paneId, session.sessionId);
      return true;
    } catch (cause: unknown) {
      setSending(false);
      setStartFailure(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const addFiles = async (files: readonly File[]): Promise<void> => {
    setAttachmentReads((count) => count + 1);
    try {
      const result = await readComposerImageAttachments(files);
      if (result.attachments.length > 0) {
        setAttachments((current) => [...current, ...result.attachments]);
      }
      setAttachmentError(result.error);
    } finally {
      setAttachmentReads((count) => count - 1);
    }
  };

  return (
    <div {...stylex.props(styles.screen)}>
      {layout.kind === "split" && <PaneHeader paneId={paneId} title="New chat" />}
      <div {...stylex.props(styles.blank)}>
        <div {...stylex.props(styles.blankColumn)}>
          {host.data !== undefined && (
            <div {...stylex.props(styles.workspaceContext)}>
              <Menu
                label="Select workspace"
                align="start"
                trigger={
                  <button
                    type="button"
                    title={workspace?.path ?? "Home"}
                    {...stylex.props(
                      styles.workspaceContextItem,
                      styles.workspaceContextButton,
                      styles.workspaceContextPath,
                      focus.ring,
                    )}
                  >
                    <span {...stylex.props(styles.workspaceContextText)}>
                      {workspace === undefined ? "Home" : displayWorkspacePath(workspace.path)}
                    </span>
                    <Icon name="chevron-down" size={10} />
                  </button>
                }
              >
                <MenuItem
                  icon="folder"
                  onSelect={() => {
                    if (workspace !== undefined) void nyte.host.closeWorkspace();
                  }}
                >
                  Home
                </MenuItem>
                {recentWorkspaces.map((candidate) => (
                  <MenuItem
                    key={candidate.path}
                    icon="folder"
                    onSelect={() => {
                      void nyte.host
                        .openWorkspace({ path: candidate.path })
                        .then(handleOpenOutcome);
                    }}
                  >
                    {candidate.name}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem
                  icon="folder-add"
                  onSelect={() => void nyte.host.pickWorkspace().then(handleOpenOutcome)}
                >
                  Open folder…
                </MenuItem>
              </Menu>
              {branch !== undefined && (
                <span
                  title={`Branch: ${branch}`}
                  {...stylex.props(styles.workspaceContextItem, styles.workspaceContextStatic)}
                >
                  <span {...stylex.props(styles.workspaceContextText)}>{branch}</span>
                </span>
              )}
              <span
                title="This Mac"
                {...stylex.props(styles.workspaceContextItem, styles.workspaceContextStatic)}
              >
                <Icon name="computer" size={13} />
                <span {...stylex.props(styles.workspaceContextText)}>This Mac</span>
              </span>
            </div>
          )}
          <ComposerFrame
            surface="new-chat"
            value={viewState.composer.draft}
            onChange={(draft) =>
              updateViewState((currentState) => ({
                composer: {
                  ...currentState.composer,
                  draft,
                  selectionStart: Math.min(currentState.composer.selectionStart, draft.length),
                  selectionEnd: Math.min(currentState.composer.selectionEnd, draft.length),
                },
              }))
            }
            onSubmit={start}
            placeholder="Plan, Build, / for skills, @ for context"
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
            inputRef={inputRef}
            selectionStart={viewState.composer.selectionStart}
            selectionEnd={viewState.composer.selectionEnd}
            onSelectionChange={(selectionStart, selectionEnd) =>
              updateViewState((currentState) => ({
                composer: { ...currentState.composer, selectionStart, selectionEnd },
              }))
            }
            onFocusChange={(focused) =>
              updateViewState((currentState) => ({
                composer: { ...currentState.composer, focused },
              }))
            }
            model={
              <ModelPicker
                catalog={catalog.data}
                current={current}
                thinkingLevel={effectiveThinkingLevel}
                fastEnabled={fastSettings}
                disabled={sending || host.data === undefined}
                onChange={handleModelPickerChange}
              />
            }
          />
          {startFailure !== undefined && (
            <div role="alert" title={startFailure} {...stylex.props(styles.error)}>
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
  const leading = layout.order[0] === paneId;
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
    <div aria-hidden="true" {...stylex.props(styles.dropPreviewLayer)}>
      <div
        data-nyte-drop-preview=""
        {...stylex.props(styles.dropPreview)}
        style={dropPreviewRect(layout, target)}
      />
    </div>
  );
}

type PanePosition =
  | { readonly kind: "single" }
  | { readonly kind: "leading"; readonly ratio: number }
  | { readonly kind: "trailing" };

function PaneHost({
  pane,
  active,
  position,
}: {
  pane: PaneState;
  active: boolean;
  position: PanePosition;
}): ReactElement {
  const actions = usePaneActions();
  const { focusRequest } = usePaneControllerSnapshot();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const attachDropTarget = useSessionPaneDropTarget(pane.id);
  const attachInput = useCallback((element: HTMLTextAreaElement | null) => {
    inputRef.current = element;
  }, []);

  useLayoutEffect(() => {
    if (focusRequest.paneId === pane.id) inputRef.current?.focus();
  }, [focusRequest.paneId, focusRequest.revision, pane.id]);

  return (
    <section
      ref={attachDropTarget}
      aria-label={`${active ? "Active " : ""}chat pane`}
      data-nyte-pane-id={pane.id}
      {...stylex.props(
        styles.pane,
        position.kind === "single" && styles.paneSingle,
        position.kind === "leading" && styles.paneLeading(position.ratio),
        position.kind === "trailing" && styles.paneTrailing,
      )}
      onPointerDown={() => actions.focus(pane.id)}
      onFocusCapture={() => actions.focus(pane.id)}
    >
      {pane.selection.kind === "session" ? (
        <SessionConversation
          paneId={pane.id}
          sessionId={pane.selection.sessionId}
          inputRef={attachInput}
        />
      ) : (
        <BlankConversation paneId={pane.id} inputRef={attachInput} />
      )}
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
      {...stylex.props(styles.sash, direction === "right" ? styles.sashRight : styles.sashDown)}
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
        {...stylex.props(
          styles.sashLine,
          direction === "right" ? styles.sashLineRight : styles.sashLineDown,
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
  const trailing = layout.kind === "split" ? (panes[1] ?? layout.secondary) : undefined;
  const activeSelection = activePane(layout).selection;
  const workspacePath = host.data?.workspace?.path;
  const workbenchTarget: WorkbenchTarget =
    activeSelection.kind === "session"
      ? { kind: "session", sessionId: activeSelection.sessionId }
      : workspacePath === undefined
        ? { kind: "home" }
        : { kind: "workspace", workspacePath };

  useLayoutEffect(() => {
    actions.syncRoute(
      routeSessionId === undefined
        ? BLANK_SELECTION
        : { kind: "session", sessionId: routeSessionId },
    );
  }, [actions, routeSessionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "F6" && layout.kind === "split") {
        event.preventDefault();
        actions.focus(activePane(layout).id === "primary" ? "secondary" : "primary");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, layout]);

  return (
    <div {...stylex.props(styles.stage)}>
      <div
        ref={containerRef}
        {...stylex.props(
          styles.panes,
          layout.kind === "split" &&
            (layout.direction === "right" ? styles.splitRight : styles.splitDown),
        )}
      >
        <PaneHost
          key={leading.id}
          pane={leading}
          active={activePane(layout).id === leading.id}
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
            active={activePane(layout).id === trailing.id}
            position={{ kind: "trailing" }}
          />
        )}
        {dropTarget !== undefined && <DropPreview layout={layout} target={dropTarget} />}
      </div>
      <Workbench target={workbenchTarget} paneKey={WORKBENCH_STAGE_PANE_KEY} />
    </div>
  );
}
