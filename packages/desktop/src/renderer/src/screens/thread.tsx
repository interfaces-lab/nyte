/**
 * The persistent desktop stage. Pane hosts are keyed only by PaneId; selecting
 * another session changes a host's data binding without replacing its DOM or
 * its view-state owner.
 */
import * as stylex from "@stylexjs/stylex";
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
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Virtualizer } from "@tanstack/react-virtual";
import { changesFromTurns, isTerminalPhase } from "@nyte-ai/core/views";
import type { SessionId, Turn, UserTurnPart } from "@nyte-ai/core";
import { toast } from "@nyte-ai/ui/sonner";
import type { DesktopVcsSnapshot } from "../../../shared/ipc.ts";
import type { Lane } from "@nyte-ai/core";
import {
  Composer,
  ComposerFrame,
  readComposerImageAttachments,
} from "../conversation/composer.tsx";
import type { ComposerImageAttachment } from "../conversation/composer.tsx";
import { composerSource } from "../conversation/composer-suggestions.tsx";
import { dropHandlers } from "../conversation/composer-file-drop.ts";
import type {
  ComposerDocumentState,
  ComposerSubmission,
} from "../conversation/composer-document.ts";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import { composerSendInput, composerSendPlan } from "../conversation/composer-send.ts";
import type {
  BranchModelChoice,
  BranchModelPicker,
  TurnChangesTarget,
} from "../conversation/turn-view.tsx";
import { ModelPicker } from "../conversation/model-picker.tsx";
import { updateDraftModel } from "../conversation/blank-draft.ts";
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
import { conversation, layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { nyte } from "../nyte.ts";
import { sessionReadState } from "../session-read-state.ts";

import { BackgroundWork } from "../conversation/jobs-panel.tsx";
import type { BackgroundWorkSection } from "../conversation/jobs-panel.tsx";
import { LiveTurn, liveTurnStyles } from "../conversation/live-turn.tsx";
import { ReferenceOpenerProvider } from "../conversation/reference-opener.tsx";
import { TurnView, UserMessageView } from "../conversation/turn-view.tsx";
import { TranscriptSkeleton } from "./transcript-skeleton.tsx";
import { Selections } from "../conversation/selection.tsx";
import { parkedSelections } from "../conversation/selection.ts";
import { displayTranscriptParts } from "../conversation/transcript-presentation.ts";
import {
  estimateRowSize,
  promptRowCount,
  rendersInTranscript,
  rowHasPrompt,
  transcriptRows,
} from "../conversation/transcript-rows.ts";
import type { TranscriptRow } from "../conversation/transcript-rows.ts";
import {
  activeStickyCandidate,
  initialTranscriptOffset,
  isBottomPinned,
  overscrollReserve,
  PROMPT_TOP_INSET,
  remainingOverscroll,
  shouldAdjustScrollForResize,
  TRANSCRIPT_PADDING_END,
  TRANSCRIPT_PADDING_START,
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
  // The stuck prompt sits 10px below the top edge; content scrolling through
  // that gap fades out instead of cutting off at the edge. Rows resize under
  // the virtualizer's own corrections, so the browser's anchoring stays out.
  scroll: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowAnchor: "none",
    maskImage: {
      default: null,
      "[data-scrolled='true']": "linear-gradient(to bottom, transparent, black 10px)",
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
    outlineColor: t.focusRing,
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
 * gap padding, so a scroll tick reads no rects. The scrollport learns whether
 * it is scrolled so it can fade its top edge under the stuck prompt.
 */
function syncStickyUserMessage(scroll: HTMLDivElement, virtualizer: TranscriptVirtualizer): void {
  setDataState(scroll, "scrolled", scroll.scrollTop > 0);
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
}

interface OverscrollReservation {
  readonly sessionId: SessionId;
  readonly initial: number;
  /** Content height (padding excluded) when the reserve was taken. */
  readonly baseline: number;
  readonly reserve: number;
}

/**
 * The virtualized transcript. It owns the scroll behaviours that need the
 * virtualizer (sticky prompts, the send-time overscroll reserve, composer
 * height compensation, restore) and leaves the scrollport, the composer,
 * and the persisted scroll state to the conversation around it. It is its
 * own component because the virtualizer instance mutates in place and the
 * compiler bails out of memoizing whatever calls it. It is keyed by session
 * so each visit gets a fresh virtualizer seeded from the last visit's
 * measurements and offset, rather than one first render at the previous
 * session's scroll position.
 */
function TranscriptPlane({
  paneId,
  sessionId,
  ready,
  scrollRef,
  rows,
  renderRow,
}: {
  paneId: PaneId;
  sessionId: SessionId;
  ready: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  rows: readonly TranscriptRow[];
  renderRow: (row: TranscriptRow) => ReactNode;
}): ReactElement {
  const viewStore = usePaneViewStateStore();
  const dockHeight = useRef(0);
  const promptTrack = useRef<{ sessionId: SessionId | undefined; count: number }>({
    sessionId: undefined,
    count: 0,
  });
  const pendingPin = useRef<number | undefined>(undefined);
  const [overscroll, setOverscroll] = useState<OverscrollReservation>();
  const reserve = overscroll?.sessionId === sessionId ? overscroll.reserve : 0;
  // What the last visit measured, read once: the virtualizer consults its
  // initial options only until the scrollport reports, and the plane is
  // keyed by session so each visit gets a fresh instance. Rows already
  // measured take their real height; the rest keep their estimate.
  const [restore] = useState(() => {
    const { transcript, scroll } = viewStore.readSession(sessionId, paneId);
    const measured = new Map(transcript.measurements.map((item) => [item.key, item.size]));
    return {
      measurements: [...transcript.measurements],
      rect: transcript.viewport ?? { width: 0, height: 0 },
      offset: initialTranscriptOffset({
        sizes: rows.map((row) => measured.get(row.key) ?? estimateRowSize(row)),
        paddingStart: TRANSCRIPT_PADDING_START,
        paddingEnd: TRANSCRIPT_PADDING_END,
        viewportHeight: transcript.viewport?.height ?? 0,
        scroll,
      }),
    };
  });
  // The key extractor is a dependency of the virtualizer's measurement memo;
  // a fresh closure per render would rebuild every item's layout.
  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);
  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateRowSize(rows[index]),
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
    paddingEnd: TRANSCRIPT_PADDING_END + reserve,
    // Fires after every measurement and scroll: item starts may have moved
    // under the stuck prompt, and a growing reply eats into the reserve.
    onChange: (instance) => {
      const scroll = scrollRef.current;
      if (scroll !== null) syncStickyUserMessage(scroll, instance);
      if (overscroll === undefined || overscroll.sessionId !== sessionId) return;
      const next = remainingOverscroll({
        initial: overscroll.initial,
        baseline: overscroll.baseline,
        content: instance.getTotalSize() - instance.options.paddingEnd,
      });
      if (next !== overscroll.reserve) setOverscroll({ ...overscroll, reserve: next });
    },
  });

  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
      shouldAdjustScrollForResize({
        start: item.start,
        end: item.end,
        // The size cache is written after this decision, so a missing entry
        // means this is the row's first real measurement.
        firstMeasure: !instance.itemSizeCache.has(item.key),
        scrollTop: (instance.scrollOffset ?? 0) + instance.scrollAdjustments,
        scrollingBackward: instance.scrollDirection === "backward",
      });
  }, [virtualizer]);

  // Leaving the session keeps what this visit measured for the next one.
  useLayoutEffect(
    () => () => {
      viewStore.updateSession(sessionId, paneId, (current) => ({
        ...current,
        transcript: {
          measurements: virtualizer.takeSnapshot(),
          viewport: virtualizer.scrollRect ?? undefined,
        },
      }));
    },
    [paneId, sessionId, viewStore, virtualizer],
  );

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
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
  }, [paneId, ready, scrollRef, sessionId, viewStore, virtualizer]);

  // Rows have been measured by their refs by the time this runs, so the
  // virtualizer's totals are current for the reserve arithmetic below.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (scroll === null) return;
    syncStickyUserMessage(scroll, virtualizer);

    // The reserve from the previous commit is in the DOM now; the prompt can
    // reach the top edge.
    const pin = pendingPin.current;
    if (pin !== undefined && overscroll?.sessionId === sessionId) {
      pendingPin.current = undefined;
      virtualizer.scrollToOffset(pin);
    }

    const count = promptRowCount(rows);
    const track = promptTrack.current;
    const sent = track.sessionId === sessionId && count > track.count;
    promptTrack.current = { sessionId, count };
    const pinned = viewStore.readSession(sessionId, paneId).scroll.bottomPinned;
    const index = rows.findLastIndex(rowHasPrompt);
    const row = rows[index];
    if (!sent || !pinned || row === undefined) return;
    // Reserve bottom overscroll so the new prompt can scroll to the top edge
    // before its reply exists; the reserve then gives way to the reply.
    const content = virtualizer.getTotalSize() - virtualizer.options.paddingEnd;
    const item = virtualizer.measurementsCache[index];
    const wrapper = virtualizer.elementsCache.get(row.key);
    const turn = wrapper?.firstElementChild;
    if (item === undefined || wrapper === undefined || !(turn instanceof HTMLElement)) return;
    const initial = overscrollReserve({
      viewportHeight: scroll.clientHeight,
      rowHeight: turn.offsetHeight,
      dockHeight: dockHeight.current,
    });
    // A row mounted mid-scroll is still an estimate in the totals; the
    // baseline uses its real height so the reply's growth alone shrinks the reserve.
    const baseline = content - item.size + wrapper.offsetHeight;
    pendingPin.current = item.start + turn.offsetTop - PROMPT_TOP_INSET;
    setOverscroll({ sessionId, initial, baseline, reserve: initial });
  }, [overscroll, paneId, rows, scrollRef, sessionId, viewStore, virtualizer]);

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
  const renameSession = useRenameSession();
  const sessionActions = useSessionActions();
  const removeSession = useSessionRemoval();
  const [draftName, setDraftName] = useState<string | undefined>();
  const [deletion, setDeletion] = useState<SessionDeletionState>({ kind: "closed" });
  const [navigating, setNavigating] = useState(false);
  const [backgroundWork, setBackgroundWork] = useState<{
    sessionId: SessionId;
    section: BackgroundWorkSection;
  }>();
  const openBackgroundWork =
    backgroundWork?.sessionId === sessionId ? backgroundWork.section : undefined;
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
  const settledRun =
    snapshot.data !== undefined &&
    snapshot.data.session.heads.some(
      (head) => head.run !== undefined && !isTerminalPhase(head.run.phase),
    );
  // Whether a submitted message steers a live run or opens the next turn is
  // read from the snapshot alone, so one coherent read moves each message from
  // the outbox to `pending` to the transcript without a detour through the
  // composer strip.
  const unsent = useOutboxRows(sessionId);
  const pending = snapshot.data?.pending ?? [];
  const landing = settledRun
    ? []
    : [
        ...pending.map((item) => ({ key: item.change, content: item.content })),
        ...unsent
          .filter((row) => row.state.kind !== "failed")
          .map((row) => ({ key: row.key, content: row.content })),
      ];
  const working = navigating || live.runState !== "idle" || settledRun || landing.length > 0;
  const cwd = host.data?.workspace?.path;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [bottomPinned, setBottomPinned] = useState(
    () => viewStore.readSession(sessionId, paneId).scroll.bottomPinned,
  );
  const ready = snapshot.data !== undefined;
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (scroll !== null) setBottomPinned(isBottomPinned(scroll));
  }, [ready, sessionId]);
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
  // The indicator belongs under the last turn the transcript draws, which is
  // not always the last turn in the snapshot.
  const lastTurn = turns.findLast(rendersInTranscript);
  // The card belongs to the newest turn that actually wrote files. Keying it
  // to the newest turn instead took the review away whenever the next message
  // settled without changes, which is most follow-ups.
  const latestChangedTurn = turns.findLast(
    (turn) => turn.kind === "turn" && changesFromTurns([turn]).length > 0,
  );
  // A turn that ends in a work group already draws the run's indicator there.
  // One that ends in prose needs it below the prose, or the model looks idle
  // while it prepares its next step.
  const settledWork =
    lastTurn?.kind === "turn" && displayTranscriptParts(lastTurn.parts).at(-1)?.kind === "work";
  const rows = transcriptRows({
    loading: snapshot.isLoading,
    failed: snapshot.isError,
    turns,
    landing,
    retrying: live.runState === "retrying" ? live.retry.message : undefined,
    working,
    selections: parkedSelections(snapshot.data?.parked).length,
  });

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
      try {
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
      } finally {
        setNavigating(false);
      }
    },
    [fastEnabled, sessionId],
  );
  const subagentInspector = useMemo(
    () => ({
      sessionId,
      inspect: (childSessionId: SessionId): void => {
        const viewKey = workbenchViewKey({
          paneKey: WORKBENCH_STAGE_PANE_KEY,
          target: { kind: "session", sessionId },
        });
        agentActions.select(viewKey, childSessionId);
        workbenchController.actions.openTab(viewKey, "agents");
      },
    }),
    [sessionId],
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
  const renderRow = (row: TranscriptRow): ReactNode => {
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
              onClick={() => void snapshot.refetch()}
            >
              Try again
            </button>
          </div>
        );
      case "turn":
        return (
          <TurnView
            turn={row.turn}
            // Settled turns carry their tool results; only the trailing turn has calls in flight.
            liveTools={row.trailing ? live.tools : NO_LIVE_TOOLS}
            live={working && row.trailing ? live : undefined}
            cwd={cwd}
            onEditUser={editUserMessage}
            branchModel={branchModel}
            onOpenChanges={!working && row.turn === latestChangedTurn ? openChanges : undefined}
            running={working && row.trailing}
          />
        );
      case "landing":
        return (
          <div data-sticky-turn {...stylex.props(liveTurnStyles.root)}>
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
        return <LiveTurn live={live} working={working} settledWork={settledWork} cwd={cwd} />;
      case "selections":
        return (
          <Selections
            sessionId={sessionId}
            parked={snapshot.data?.parked}
            disabled={snapshot.isError || navigating}
          />
        );
      default: {
        const _exhaustive: never = row;
        return _exhaustive;
      }
    }
  };

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
              ref={scrollRef}
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
                key={sessionId}
                paneId={paneId}
                sessionId={sessionId}
                ready={ready}
                scrollRef={scrollRef}
                rows={rows}
                renderRow={renderRow}
              />

              <Composer
                key={sessionId}
                sessionId={sessionId}
                backgroundWork={{
                  content: (
                    <BackgroundWork
                      key={sessionId}
                      sessionId={sessionId}
                      terminalOwner={workbenchViewKey({
                        paneKey: WORKBENCH_STAGE_PANE_KEY,
                        target: { kind: "session", sessionId },
                      })}
                      open={openBackgroundWork}
                      onOpenChange={(section) =>
                        setBackgroundWork(
                          section === undefined ? undefined : { sessionId, section },
                        )
                      }
                      onInspect={subagentInspector.inspect}
                      onOpenTerminal={(job) => {
                        const viewKey = workbenchViewKey({
                          paneKey: WORKBENCH_STAGE_PANE_KEY,
                          target: { kind: "session", sessionId },
                        });
                        const terminalId = terminalActions.openJob(viewKey, sessionId, job);
                        workbenchController.actions.openTab(viewKey, "terminal");
                        focusTerminal(terminalId);
                      }}
                      viewportRef={scrollRef}
                    />
                  ),
                  onEscape: () => {
                    if (openBackgroundWork === undefined) return false;
                    setBackgroundWork(undefined);
                    return true;
                  },
                }}
                working={working}
                pending={settledRun ? pending : []}
                unsent={settledRun ? unsent : unsent.filter((row) => row.state.kind === "failed")}
                disabled={snapshot.data === undefined || snapshot.isError}
                fileDropRoot={scrollRef}
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
                        const scroll = scrollRef.current;
                        if (scroll === null) return;
                        scroll.scrollTop = scroll.scrollHeight;
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
            description="The chat disappears now. You can undo from the notification before it closes; after that, deletion is permanent."
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
  const branch = workspace === undefined ? undefined : repositoryBranch(vcs.data);
  const recentWorkspaces = (workspaces.data ?? []).filter(
    (candidate) => candidate.path !== workspace?.path,
  );
  const configuration = viewState.configuration ?? catalog.data?.defaults;
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
    const submittedConfiguration = submitted.configuration ?? catalog.data?.defaults;
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
        const outcome = await nyte.plugins.settings.apply({
          sessionId: session.sessionId,
          id: submittedModel.fastMode.settingId,
          choiceId: "on",
        });
        if (outcome.kind !== "applied") throw new Error("Fast mode is no longer available");
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
      <div
        {...stylex.props(styles.blank)}
        {...dropHandlers({
          onFiles: (files) => {
            void addFiles(files);
          },
          disabled: sending || host.data === undefined,
        })}
      >
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
            inputRef={inputRef}
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
  const viewStore = usePaneViewStateStore();
  useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot, viewStore.getSnapshot);
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
      <ReferenceOpenerProvider value={referenceOpener}>
        {pane.selection.kind === "session" ? (
          <SessionConversation
            paneId={pane.id}
            sessionId={pane.selection.sessionId}
            inputRef={attachInput}
          />
        ) : (
          <BlankConversation
            key={viewStore.readBlank(pane.id).id}
            paneId={pane.id}
            inputRef={attachInput}
          />
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
  const trailing = layout.kind === "split" ? (panes[1] ?? layout.secondary) : undefined;
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
