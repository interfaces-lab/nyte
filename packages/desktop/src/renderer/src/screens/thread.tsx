/**
 * The persistent desktop stage. Pane hosts are keyed only by PaneId, so a
 * pane's chrome, size and view-state owner survive a selection change. The
 * conversation inside is keyed by SessionId instead: the transcript plane and
 * the composer share one scrollport, and a chat's absolutely positioned rows
 * only leave that scrollport when the surface holding them is replaced.
 */
import * as stylex from "@stylexjs/stylex";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, PointerEvent, ReactElement, ReactNode, RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { SessionId, SessionInfo, Turn, UserTurnPart } from "@nyte-ai/protocol";
import { toast } from "@nyte-ai/ui/sonner";
import type { VcsSnapshot } from "@nyte-ai/protocol";
import type { Lane } from "@nyte-ai/protocol";
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
import { laneRoles } from "../conversation/composer-keys.ts";
import type {
  BranchModelChoice,
  BranchModelPicker,
  TurnChangesTarget,
} from "../conversation/turn-view.tsx";
import { ModelPicker } from "../conversation/model-picker.tsx";
import { draftConfiguration, updateDraftModel } from "../conversation/blank-draft.ts";
import { Icon } from "../components/icons.tsx";
import { FileTypeIconSprite } from "../components/file-type-icon.tsx";
import { Menu, MenuItem, MenuSeparator } from "../components/menu.tsx";
import { focus, IconButton } from "../components/ui.tsx";
import { handleOpenOutcome } from "../chrome/open-workspace.tsx";
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
import { loadThread, useSessionLive } from "../live.ts";
import type { LiveToolProgress } from "../live-fold.ts";
import {
  keys,
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
  useVcsSnapshot,
  useWorkspaces,
} from "../queries.ts";
import { useSessionRemoval } from "../layout/use-session-removal.ts";
import { macPlatform } from "../platform.ts";
import { outbox, useOutboxRows } from "../use-outbox.ts";
import { conversation, layer, pane } from "../theme/schema.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { t } from "../theme/vars.stylex.ts";
import { nyte } from "../nyte.ts";
import type { DesktopModelOption } from "../nyte.ts";
import { sessionReadState } from "../session-read-state.ts";

import { BackgroundWork } from "../conversation/jobs-panel.tsx";
import { LiveTurn, liveTurnStyles } from "../conversation/live-turn.tsx";
import { ReferenceOpenerProvider } from "../conversation/reference-opener.tsx";
import { TurnView, UserMessageView } from "../conversation/turn-view.tsx";
import { TranscriptSkeleton } from "./transcript-skeleton.tsx";
import { Selections } from "../conversation/selection.tsx";
import { parkedSelections } from "../conversation/selection.ts";
import {
  NO_WAITS,
  displayTranscriptParts,
  liveWaits,
} from "../conversation/transcript-presentation.ts";
import type { LiveWaits } from "../conversation/transcript-presentation.ts";
import {
  conversationMessages,
  estimateRowSize,
  rendersInTranscript,
  transcriptRows,
} from "../conversation/transcript-rows.ts";
import type { RenderedTurn, TranscriptRow } from "../conversation/transcript-rows.ts";
import {
  activeStickyCandidate,
  initialTranscriptOffset,
  isBottomPinned,
  TRANSCRIPT_PADDING_START,
  transcriptPaddingEnd,
} from "../conversation/transcript-scroll.ts";
import type { StickyCandidate } from "../conversation/transcript-scroll.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import {
  WORKBENCH_STAGE_PANE_KEY,
  workbenchController,
  workbenchViewKey,
} from "../workbench/controller.ts";
import type { WorkbenchTarget } from "../workbench/controller.ts";
import { Workbench } from "../workbench/workbench.tsx";
import { workbenchReferenceOpener } from "../workbench/open-reference.ts";
import { terminalActions } from "../workbench/terminal-store.ts";
import { agentActions } from "../workbench/agents-store.ts";
import { SubagentInspectorProvider } from "../conversation/subagent-inspector.ts";
import { focusTerminal } from "../workbench/terminal-runtime.ts";
import { clientActions, clientActionShortcut } from "../../../shared/client-actions.ts";
import { errorMessage } from "../../../shared/errors.ts";

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
    borderColor: { default: t.strokeSecondary, ":focus-visible": t.strokeFocused },
    backgroundColor: t.bgElevated,
    color: t.textPrimary,
    fontSize: t.fontBase,
    fontWeight: 600,
    outline: "none",
  },
  body: { position: "relative", display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  conversation: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  // Rows dissolve at the top edge the way they do at the composer, over the
  // same distance. A stuck prompt covers that edge with its own opaque inset
  // and turns the mask off: masking the scrollport would make the strip
  // translucent again and let rows surface above the prompt.
  //
  // Rows resize under the virtualizer's own corrections, so the browser's
  // anchoring stays out.
  scroll: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowAnchor: "none",
    maskImage: {
      default: null,
      "[data-top-fade='true']": `linear-gradient(to bottom, transparent, black ${conversation.edgeFade})`,
    },
  },
  // The plane's height is the virtualizer's total; rows sit inside it at
  // their measured offsets. Top and bottom padding live in the virtualizer
  // (`paddingStart`/`paddingEnd`), the turn gap on each row.
  transcript: {
    position: "relative",
    flexGrow: 1,
    flexShrink: 0,
    width: `min(${conversation.measure}, 100%)`,
    marginInline: "auto",
  },
  // `top` rather than a transform: the prompt inside is `position: sticky`,
  // and a transformed ancestor would pin it to the row instead of the
  // scrollport. A row that renders nothing drops its gap like a missing flex
  // item would.
  row: {
    position: "absolute",
    insetInline: 0,
    paddingInline: conversation.gutter,
    paddingTop: { default: conversation.turnGap, ":empty": 0 },
    contain: "layout",
  },
  rowFirst: { paddingTop: 0 },
  banner: {
    width: "fit-content",
    padding: "4px 10px",
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
    gap: 4,
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
    paddingInline: 4,
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
  workspaceContextStatic: { height: 26, paddingInline: 4 },
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
    outlineColor: t.focusRing,
    outlineOffset: -2,
  },
  sashRight: { width: pane.sashSize, cursor: "col-resize" },
  sashDown: { height: pane.sashSize, cursor: "row-resize" },
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
const EMPTY_MODEL_OPTIONS: readonly DesktopModelOption[] = [];
const NO_LIVE_TOOLS: ReadonlyMap<string, LiveToolProgress> = new Map();
const TRANSCRIPT_OVERSCAN = 4;

type TranscriptVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

function setDataState(element: HTMLElement, name: string, active: boolean): void {
  const value = active ? "true" : "false";
  if (element.dataset[name] !== value) element.dataset[name] = value;
}

/**
 * The real user row stays sticky inside its turn boundary. Mutating a data
 * state here avoids cloning the prompt or rerendering the transcript on
 * every scroll tick; React continues to own the row and its edit state.
 * A turn's top comes from the virtualizer's cached item start plus the row's
 * gap padding, so a scroll tick reads no rects. The scrollport also learns
 * whether its top edge is exposed, which is what decides the fade there.
 */
function syncStickyUserMessage(scroll: HTMLDivElement, virtualizer: TranscriptVirtualizer): void {
  // Item starts are computed lazily; the total forces the cache current.
  virtualizer.getTotalSize();
  // Only turn rows carry the marker, so the scrollport is a safe query root.
  const rows = scroll.querySelectorAll<HTMLElement>("[data-sticky-user-message]");
  const candidates: StickyCandidate[] = [];
  const candidateRows: HTMLElement[] = [];

  for (const row of rows) {
    const turn = row.closest<HTMLElement>("[data-sticky-turn='true']");
    const wrapper = row.closest<HTMLDivElement>("[data-index]");
    const item =
      wrapper === null
        ? undefined
        : virtualizer.measurementsCache[virtualizer.indexFromElement(wrapper)];
    const eligible = turn !== null && item !== undefined && row.offsetHeight < scroll.clientHeight;
    setDataState(row, "stickyDisabled", !eligible);
    if (!eligible || turn === null || item === undefined) continue;
    candidates.push({ start: item.start + turn.offsetTop, height: item.size });
    candidateRows.push(row);
  }

  const active = activeStickyCandidate(candidates, scroll.scrollTop, isBottomPinned(scroll));
  const activeRow = active === undefined ? undefined : candidateRows[active];
  for (const row of rows) setDataState(row, "stickyActive", row === activeRow);
  setDataState(scroll, "topFade", scroll.scrollTop > 0 && activeRow === undefined);
}

/**
 * The virtualized transcript. It owns the scroll behaviours that need the
 * virtualizer (sticky prompts, composer height compensation, restore) and
 * leaves the scrollport, the composer, and the persisted scroll state to the
 * conversation around it. It is its own component because the virtualizer
 * instance mutates in place and the compiler bails out of memoizing whatever
 * calls it. A session change replaces the conversation around it, so each
 * visit builds a virtualizer seeded from that session's last measurements
 * and offset rather than from whatever the previous chat left on screen.
 */
const TranscriptPlane = memo(function TranscriptPlane({
  paneId,
  sessionId,
  ready,
  scroll,
  rows,
  renderRow,
}: {
  paneId: PaneId;
  sessionId: SessionId;
  /** Whether the snapshot has landed. The persisted offset can only be
   * restored once the rows it was measured against exist, so the restore
   * effect below runs again when a cold open finishes loading. */
  ready: boolean;
  /** The scrollport node itself: a ref box would still read null on the mount
   * that creates it, because React attaches a host ref after its descendants'
   * layout effects. */
  scroll: HTMLDivElement | null;
  rows: readonly TranscriptRow[];
  renderRow: (row: TranscriptRow) => ReactNode;
}): ReactElement {
  const viewStore = usePaneViewStateStore();
  const density = useAppearanceSettings().toolCalls;
  const dockHeight = useRef(0);
  // What the last visit measured, read once: the virtualizer consults its
  // initial options only until the scrollport reports. Rows already measured
  // take their real height; the rest keep their estimate. Heights remembered
  // under another density describe different rows, so a density switch starts
  // from estimates again.
  const [restore] = useState(() => {
    const { transcript, scroll } = viewStore.readSession(sessionId, paneId);
    const measurements = transcript.density === density ? transcript.measurements : [];
    const measured = new Map(measurements.map((item) => [item.key, item.size]));
    return {
      measurements: [...measurements],
      rect: transcript.viewport ?? { width: 0, height: 0 },
      offset: initialTranscriptOffset({
        sizes: rows.map((row) => measured.get(row.key) ?? estimateRowSize(row, density)),
        viewportHeight: transcript.viewport?.height ?? 0,
        scroll,
      }),
    };
  });
  // The slack under the last row scales with the scrollport, so the plane
  // follows it. What the last visit measured carries the first paint until
  // the observer below reports this one.
  const [viewportHeight, setViewportHeight] = useState(restore.rect.height);
  // The key extractor is a dependency of the virtualizer's measurement memo;
  // a fresh closure per render would rebuild every item's layout.
  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);
  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scroll,
    estimateSize: (index) => estimateRowSize(rows[index], density),
    getItemKey,
    // The virtualizer owns the plane height and row tops, so a scroll tick
    // rerenders only when the visible range changes. `position` keeps `top`
    // so the sticky prompt pins to the scrollport, not to a transformed row.
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    initialMeasurementsCache: restore.measurements,
    initialRect: restore.rect,
    initialOffset: restore.offset,
    overscan: TRANSCRIPT_OVERSCAN,
    paddingStart: TRANSCRIPT_PADDING_START,
    paddingEnd: transcriptPaddingEnd(viewportHeight),
    // Fires after every measurement and scroll: item starts may have moved
    // under the stuck prompt.
    onChange: (instance) => {
      if (scroll !== null) syncStickyUserMessage(scroll, instance);
    },
  });

  // Leaving the session keeps what this visit measured for the next one.
  useLayoutEffect(
    () => () => {
      const measurements = virtualizer.takeSnapshot();
      viewStore.updateSession(sessionId, paneId, (current) =>
        // Leaving before a single row measured would replace the last visit's
        // heights with nothing, and the next visit would open on estimates.
        measurements.length === 0
          ? current
          : {
              ...current,
              transcript: {
                measurements,
                viewport: virtualizer.scrollRect ?? undefined,
                density,
              },
            },
      );
    },
    [density, paneId, sessionId, viewStore, virtualizer],
  );

  useLayoutEffect(() => {
    // The plane is the scrollport's first child; the composer dock is its last.
    const plane = scroll?.firstElementChild;
    if (scroll === null || !(plane instanceof HTMLElement)) return undefined;
    const last = scroll.lastElementChild;
    const dock = last instanceof HTMLElement ? last : undefined;
    dockHeight.current = dock?.offsetHeight ?? 0;
    const restored = viewStore.readSession(sessionId, paneId).scroll;
    // Restoration must go through the virtualizer so its scroll target moves
    // too; a direct scrollTop write is undone by its initial reconcile.
    if (restored.bottomPinned) virtualizer.scrollToEnd();
    else virtualizer.scrollToOffset(restored.top);

    // The commit effect below and the observer's initial delivery both sync
    // the sticky prompt, so no explicit sync is needed here.
    const sync = (): void => syncStickyUserMessage(scroll, virtualizer);
    // Streamed text, late highlights, a growing composer, and a shrinking
    // scrollport all move the bottom; a reader pinned there follows it. A
    // reader elsewhere keeps what they are looking at: the dock grows over
    // the content, so the content moves up by as much.
    const observer = new ResizeObserver((entries) => {
      const pinned = viewStore.readSession(sessionId, paneId).scroll.bottomPinned;
      setViewportHeight(scroll.clientHeight);
      if (dock !== undefined && entries.some((entry) => entry.target === dock)) {
        const delta = dock.offsetHeight - dockHeight.current;
        dockHeight.current = dock.offsetHeight;
        if (!pinned) virtualizer.scrollToOffset(scroll.scrollTop + delta);
      }
      if (pinned) virtualizer.scrollToEnd();
      sync();
    });
    observer.observe(scroll);
    observer.observe(plane);
    if (dock !== undefined) observer.observe(dock);
    scroll.addEventListener("scroll", sync, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", sync);
    };
  }, [paneId, ready, scroll, sessionId, viewStore, virtualizer]);

  // Rows have been measured by their refs by the time this runs, so the
  // prompt that should be stuck is decided against heights the reader sees.
  useLayoutEffect(() => {
    if (scroll !== null) syncStickyUserMessage(scroll, virtualizer);
  }, [rows, scroll, virtualizer]);

  return (
    <div ref={virtualizer.containerRef} {...stylex.props(styles.transcript)}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (row === undefined) return null;
        return (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            {...stylex.props(styles.row, item.index === 0 && styles.rowFirst)}
          >
            {renderRow(row)}
          </div>
        );
      })}
    </div>
  );
});

function repositoryBranch(snapshot: VcsSnapshot | undefined): string | undefined {
  if (snapshot === undefined || snapshot.kind === "none") return undefined;
  const { branch } = snapshot.head;
  return branch.kind === "named" ? branch.name : undefined;
}

function displayWorkspacePath(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~").replace(/^\/home\/[^/]+(?=\/|$)/, "~");
}

type BlankViewUpdate = (current: BlankViewState) => BlankViewState;
type SessionDeletionState =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly sessionId: SessionId };

function useBlankViewBinding(
  paneId: PaneId,
): readonly [ChatDraft, (update: BlankViewUpdate) => void] {
  const store = usePaneViewStateStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const state = store.readBlank(paneId);
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

/**
 * Rewinds the head to a user message and resubmits it with the chosen model.
 * It lives outside the component because the React Compiler cannot lower
 * `try`/`finally`, and one bailout costs the whole component its memoization.
 */
async function applyMessageEdit({
  sessionId,
  part,
  content,
  choice,
  fastEnabled,
}: {
  readonly sessionId: SessionId;
  readonly part: UserTurnPart;
  readonly content: UserTurnPart["content"];
  readonly choice: BranchModelChoice;
  readonly fastEnabled: ReadonlySet<string>;
}): Promise<void> {
  const outcome = await nyte.heads.move({ sessionId, to: part.commit });
  switch (outcome.kind) {
    case "moved":
      if (outcome.restored?.commit !== part.commit) {
        throw new Error("The selected message is no longer editable.");
      }
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
      await outbox.submit({ sessionId, content });
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
}

type EditUserMessage = (
  part: UserTurnPart,
  content: UserTurnPart["content"],
  choice: BranchModelChoice,
) => Promise<void>;

const SettledTurnView = memo(function SettledTurnView({
  turn,
  cwd,
  onEditUser,
  branchModel,
  onOpenChanges,
}: {
  turn: RenderedTurn;
  cwd: string | undefined;
  onEditUser: EditUserMessage;
  branchModel: BranchModelPicker;
  onOpenChanges: ((target: TurnChangesTarget) => void) | undefined;
}): ReactElement | null {
  return (
    <TurnView
      turn={turn}
      liveTools={NO_LIVE_TOOLS}
      cwd={cwd}
      onEditUser={onEditUser}
      branchModel={branchModel}
      onOpenChanges={onOpenChanges}
      running={false}
      waits={NO_WAITS}
    />
  );
});

const TrailingTurnView = memo(function TrailingTurnView({
  sessionId,
  turn,
  cwd,
  onEditUser,
  branchModel,
  onOpenChanges,
  running,
  waits,
}: {
  sessionId: SessionId;
  turn: RenderedTurn;
  cwd: string | undefined;
  onEditUser: EditUserMessage;
  branchModel: BranchModelPicker;
  onOpenChanges: ((target: TurnChangesTarget) => void) | undefined;
  running: boolean;
  waits: LiveWaits;
}): ReactElement | null {
  const live = useSessionLive(sessionId);
  return (
    <TurnView
      turn={turn}
      liveTools={live.tools}
      live={live}
      cwd={cwd}
      onEditUser={onEditUser}
      branchModel={branchModel}
      onOpenChanges={onOpenChanges}
      running={running}
      waits={waits}
    />
  );
});

const SessionLiveTurn = memo(function SessionLiveTurn({
  sessionId,
  working,
  settledWork,
  cwd,
}: {
  sessionId: SessionId;
  working: boolean;
  settledWork: boolean;
  cwd: string | undefined;
}): ReactElement | null {
  const live = useSessionLive(sessionId);
  return <LiveTurn live={live} working={working} settledWork={settledWork} cwd={cwd} />;
});

function SessionConversation({
  paneId,
  sessionId,
  inputRef,
}: {
  paneId: PaneId;
  sessionId: SessionId;
  inputRef: (element: ComposerEditorHandle | null) => void;
}): ReactElement {
  const host = useHostState();
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
  const [backgroundWork, setBackgroundWork] = useState(false);
  const paneMenuTrigger = useRef<HTMLButtonElement>(null);
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
        steerLane: laneRoles(nyte.landing).steer,
      }),
    [snapshot.data, unsent],
  );
  const working =
    navigating || live.runState !== "idle" || messages.running || messages.landing.length > 0;
  const cwd = host.data?.workspace?.path;
  // The scrollport arrives as state so everything below it re-runs on the
  // commit that creates the node, not one commit late.
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  // The store holds where this chat was left, and the restore puts the
  // scrollport back at that offset, so the two agree until the reader moves
  // and the scroll handler takes over.
  const [bottomPinned, setBottomPinned] = useState(
    () => viewStore.readSession(sessionId, paneId).scroll.bottomPinned,
  );
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
  // The card belongs to the newest turn that actually wrote files. Keying it
  // to the newest turn instead took the review away whenever the next message
  // settled without changes, which is most follow-ups.
  const latestChangedTurn = useMemo(
    () =>
      turns.findLast(
        (turn) =>
          turn.kind === "turn" &&
          turn.parts.some(
            (part) =>
              part.kind === "tool" &&
              part.class.kind === "file_patch" &&
              part.result?.isError === false,
          ),
      ),
    [turns],
  );
  // A turn that ends in a work group already draws the run's indicator there,
  // as does one whose live wait on its children is drawn as status. One that
  // ends in prose needs it below the prose, or the model looks idle while it
  // prepares its next step.
  const parked = snapshot.data?.parked;
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
  const selections = parkedSelections(parked).length;
  const rows = useMemo(
    () =>
      transcriptRows({
        loading: snapshot.isLoading,
        failed: snapshot.isError,
        turns,
        landing: messages.landing,
        retrying,
        working,
        selections,
      }),
    [snapshot.isLoading, snapshot.isError, turns, messages.landing, retrying, working, selections],
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
      return applyMessageEdit({ sessionId, part, content, choice, fastEnabled }).finally(() =>
        setNavigating(false),
      );
    },
    [fastEnabled, sessionId],
  );
  const childBySession = useMemo(
    () =>
      new Map<SessionId, SessionInfo>(
        (children.data ?? []).map((child) => [child.sessionId, child]),
      ),
    [children.data],
  );
  const subagentInspector = useMemo(
    () => ({
      sessionId,
      children: childBySession,
      inspect: (child: SessionId): void => {
        const viewKey = workbenchViewKey({
          paneKey: WORKBENCH_STAGE_PANE_KEY,
          target: { kind: "session", sessionId },
        });
        agentActions.select(viewKey, child);
        workbenchController.actions.openTab(viewKey, "agents");
      },
    }),
    [childBySession, sessionId],
  );
  const openChanges = useCallback(
    (target: TurnChangesTarget): void => {
      const viewKey = workbenchViewKey({
        paneKey: WORKBENCH_STAGE_PANE_KEY,
        target: { kind: "session", sessionId },
      });
      workbenchController.actions.selectChangesScope(viewKey, {
        kind: "turn",
        turnId: target.turnId,
      });
      if (target.kind === "file") {
        workbenchController.actions.revealPath(viewKey, target.path);
      }
      workbenchController.actions.openTab(viewKey, "changes");
    },
    [sessionId],
  );
  const snapshotError = snapshot.isError;
  const refetchSnapshot = snapshot.refetch;
  const renderRow = useCallback(
    (row: TranscriptRow): ReactNode => {
      switch (row.kind) {
        case "skeleton":
          return <TranscriptSkeleton />;
        case "error":
          return (
            <div role="alert" {...stylex.props(styles.banner)}>
              Couldn&rsquo;t load this chat.{" "}
              <button
                type="button"
                {...stylex.props(styles.bannerAction, focus.ring)}
                onClick={() => void refetchSnapshot()}
              >
                Try again
              </button>
            </div>
          );
        case "turn": {
          const onOpenChanges =
            !working && row.turn === latestChangedTurn ? openChanges : undefined;
          if (row.trailing && working) {
            return (
              <TrailingTurnView
                sessionId={sessionId}
                turn={row.turn}
                cwd={cwd}
                onEditUser={editUserMessage}
                branchModel={branchModel}
                onOpenChanges={onOpenChanges}
                running={working}
                waits={lastWaits}
              />
            );
          }
          return (
            <SettledTurnView
              turn={row.turn}
              cwd={cwd}
              onEditUser={editUserMessage}
              branchModel={branchModel}
              onOpenChanges={onOpenChanges}
            />
          );
        }
        case "landing":
          return (
            <div
              data-sticky-turn
              title={row.pending ? "Lands at the next response" : undefined}
              {...stylex.props(liveTurnStyles.root, row.pending && liveTurnStyles.pending)}
            >
              <UserMessageView content={row.content} />
            </div>
          );
        case "retry":
          return (
            <div role="status" title={row.message} {...stylex.props(styles.banner)}>
              Retrying…
            </div>
          );
        case "live":
          return (
            <SessionLiveTurn
              sessionId={sessionId}
              working={working}
              settledWork={settledWork}
              cwd={cwd}
            />
          );
        case "selections":
          return (
            <Selections
              sessionId={sessionId}
              parked={parked}
              disabled={snapshotError || navigating}
            />
          );
        default: {
          const _exhaustive: never = row;
          return _exhaustive;
        }
      }
    },
    [
      branchModel,
      cwd,
      editUserMessage,
      lastWaits,
      latestChangedTurn,
      navigating,
      openChanges,
      parked,
      sessionId,
      settledWork,
      snapshotError,
      refetchSnapshot,
      working,
    ],
  );

  return (
    <SubagentInspectorProvider value={subagentInspector}>
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
              ref={setScroll}
              data-nyte-scrollport="balanced"
              {...stylex.props(styles.scroll)}
              onScroll={(event) => {
                const element = event.currentTarget;
                const nextBottomPinned = isBottomPinned(element);
                setBottomPinned(nextBottomPinned);
                viewStore.updateSession(sessionId, paneId, (current) => ({
                  ...current,
                  scroll: { top: element.scrollTop, bottomPinned: nextBottomPinned },
                }));
              }}
            >
              <TranscriptPlane
                paneId={paneId}
                sessionId={sessionId}
                ready={ready}
                scroll={scroll}
                rows={rows}
                renderRow={renderRow}
              />

              <Composer
                sessionId={sessionId}
                backgroundWork={{
                  content: (
                    <BackgroundWork
                      sessionId={sessionId}
                      terminalOwner={workbenchViewKey({
                        paneKey: WORKBENCH_STAGE_PANE_KEY,
                        target: { kind: "session", sessionId },
                      })}
                      open={backgroundWork}
                      onOpenChange={setBackgroundWork}
                      onOpenTerminal={(job) => {
                        const viewKey = workbenchViewKey({
                          paneKey: WORKBENCH_STAGE_PANE_KEY,
                          target: { kind: "session", sessionId },
                        });
                        const terminalId = terminalActions.openJob(viewKey, sessionId, job);
                        workbenchController.actions.openTab(viewKey, "terminal");
                        focusTerminal(terminalId);
                      }}
                      viewport={scroll}
                    />
                  ),
                  onEscape: () => {
                    if (!backgroundWork) return false;
                    setBackgroundWork(false);
                    return true;
                  },
                }}
                working={working}
                // The boundary lane draws in the transcript; the tray keeps the rest.
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
                inputRef={inputRef}
                autoFocus={false}
                onScrollToBottom={
                  !bottomPinned
                    ? () => {
                        if (scroll === null) return;
                        scroll.scrollTo({ top: scroll.scrollHeight });
                        setBottomPinned(true);
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </div>
        {deletion.kind === "open" && (
          <ConfirmDialog
            open
            pending={false}
            error={undefined}
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
    </SubagentInspectorProvider>
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
  const vcs = useVcsSnapshot(workspace !== undefined);
  const catalog = useCatalog();
  const pluginCatalog = usePluginCatalog();
  const workspaceFiles = useMentionFiles(workspace !== undefined);
  const workspaces = useWorkspaces();
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
  const branch = workspace === undefined ? undefined : repositoryBranch(vcs.data);
  const recentWorkspaces = (workspaces.data ?? []).filter(
    (candidate) => candidate.path !== workspace?.path,
  );
  const configuration = draftConfiguration(catalog.data, viewState.configuration);
  const current = catalog.data?.models.find(
    (option) =>
      option.provider === configuration?.model.provider && option.id === configuration.model.id,
  );

  const start = async (
    submission: ComposerSubmission,
    lane: Lane,
    document: ComposerDocumentState,
  ): Promise<boolean> => {
    if (sending || attachmentReads !== 0) return false;
    // A new chat has no plugin commands active yet; its first message is always a message.
    const plan = composerSendPlan({ submission, attachments, commands: [], lane });
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
    let session: { readonly sessionId: SessionId } | undefined;
    try {
      session = await nyte.sessions.create();
      // The pane switches as soon as the chat exists; its configuration and
      // first message finish behind the transcript instead of holding Home.
      void queryClient.invalidateQueries({ queryKey: keys.sessions });
      void loadThread(session.sessionId).catch(() => undefined);
      const configuring =
        submittedConfiguration === undefined
          ? undefined
          : configureSession(session.sessionId, submittedConfiguration);
      actions.openSessionInPane(paneId, session.sessionId);
      await configuring;
      if (
        submittedModel?.fastMode.kind === "available" &&
        submitted.fastSettings.has(submittedModel.fastMode.settingId)
      ) {
        await enableFastMode(session.sessionId, submittedModel.fastMode.settingId);
      }
      await outbox.submit(composerSendInput(session.sessionId, plan));
      setAttachments([]);
      setAttachmentError(undefined);
      return true;
    } catch (cause: unknown) {
      viewStore.restoreBlank(paneId, submitted);
      setSending(false);
      setStartFailure(errorMessage(cause));
      // Past the pane switch this composer is gone; the draft stays on Home.
      if (session !== undefined) {
        toast.error("Couldn't send the first message. Your draft is still on Home.", {
          id: "new-chat-start-error",
        });
      }
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
    <div {...stylex.props(styles.screen)}>
      {layout.kind === "split" && <PaneHeader paneId={paneId} title="New chat" />}
      <div ref={blankRef} {...stylex.props(styles.blank)}>
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
  // Pointer-down focuses the pane first, so a chip opens in the workbench this pane shows.
  const referenceOpener = useMemo(
    () =>
      workbenchReferenceOpener({
        viewKey: workbenchViewKey({
          paneKey: WORKBENCH_STAGE_PANE_KEY,
          target:
            pane.selection.kind === "session"
              ? { kind: "session", sessionId: pane.selection.sessionId }
              : workspacePath === undefined
                ? { kind: "home" }
                : { kind: "workspace", workspacePath },
        }),
        workspacePath,
      }),
    [pane.selection, workspacePath],
  );

  useLayoutEffect(() => {
    if (focusRequest.paneId === pane.id) inputRef.current?.focus();
  }, [focusRequest.paneId, focusRequest.revision, pane.id]);

  return (
    <section
      ref={attachDropTarget}
      aria-label={`${activePane(layout).id === pane.id ? "Active " : ""}chat pane`}
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
      <ReferenceOpenerProvider value={referenceOpener}>
        {pane.selection.kind === "session" ? (
          <SessionConversation
            key={pane.selection.sessionId}
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
  const trailing = layout.kind === "split" ? panes[1] : undefined;
  const activeSelection = activePane(layout).selection;
  const workspacePath = host.data?.workspace?.path;
  const workbenchTarget: WorkbenchTarget =
    activeSelection.kind === "session"
      ? { kind: "session", sessionId: activeSelection.sessionId }
      : workspacePath === undefined
        ? { kind: "home" }
        : { kind: "workspace", workspacePath };

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
    <div {...stylex.props(styles.stage)}>
      <FileTypeIconSprite />
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
      <Workbench target={workbenchTarget} paneKey={WORKBENCH_STAGE_PANE_KEY} />
    </div>
  );
}
