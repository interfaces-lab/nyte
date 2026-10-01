/**
 * Scroll behaviour for the virtualized transcript, after shadcn's
 * MessageScroller: it follows the live edge while the reader is there, keeps
 * the current turn's prompt stuck, restores where the pane left the session,
 * and drives the jump button. It knows rows only by id and anchor flag.
 */
import { props } from "@stylexjs/stylex";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { SessionId } from "@nyte-ai/protocol";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import { usePaneViewStateStore } from "../layout/pane-context.tsx";
import type { PaneId } from "../layout/pane-layout.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { messageScrollerStyles } from "./styles.stylex.ts";
import {
  activeStickyCandidate,
  initialTranscriptOffset,
  isBottomPinned,
  TRANSCRIPT_PADDING_START,
  transcriptPaddingEnd,
} from "./transcript-scroll.ts";
import type { StickyCandidate } from "./transcript-scroll.ts";

const OVERSCAN = 4;

type TranscriptVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

/** One transcript row as the scroller sees it. */
export interface MessageScrollerItem {
  readonly messageId: string;
  /** The row opens a turn; its prompt sticks while the turn is on screen. */
  readonly scrollAnchor: boolean;
}

interface MessageScrollerOptions {
  /** Where the pane keeps this session's offset and measurements. */
  readonly paneId: PaneId;
  readonly sessionId: SessionId;
  /** Follow new content while the reader is at the live edge. */
  readonly autoScroll: boolean;
  /** How close to the end still counts as being at it. */
  readonly scrollEdgeThreshold: number;
}

interface MessageScrollerState extends MessageScrollerOptions {
  /** The node itself rather than a ref box, so the parts re-run on the commit that creates it. */
  readonly viewport: HTMLDivElement | null;
  readonly setViewport: (viewport: HTMLDivElement | null) => void;
  readonly setScrollableEnd: (scrollable: boolean) => void;
}

const MessageScrollerContext = createContext<MessageScrollerState | null>(null);

/**
 * Whether the viewport can still scroll toward the end. Only the button
 * reads it, so a reader crossing the edge rerenders the button alone.
 */
const ScrollableEndContext = createContext(false);

function useMessageScroller(): MessageScrollerState {
  const scroller = useContext(MessageScrollerContext);

  if (scroller === null) throw new Error("MessageScroller parts need a MessageScrollerProvider");

  return scroller;
}

export function MessageScrollerProvider({
  paneId,
  sessionId,
  autoScroll,
  scrollEdgeThreshold,
  children,
}: MessageScrollerOptions & { readonly children: ReactNode }): ReactElement {
  const viewStore = usePaneViewStateStore();
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);

  // The store holds where this chat was left, and the restore puts the
  // viewport back at that offset, so the two agree until the reader moves.
  const [scrollableEnd, setScrollableEnd] = useState(
    () => !viewStore.readSession(sessionId, paneId).scroll.bottomPinned,
  );

  const scroller = useMemo(
    () => ({
      paneId,
      sessionId,
      autoScroll,
      scrollEdgeThreshold,
      viewport,
      setViewport,
      setScrollableEnd,
    }),
    [autoScroll, paneId, scrollEdgeThreshold, sessionId, viewport],
  );

  return (
    <MessageScrollerContext.Provider value={scroller}>
      <ScrollableEndContext.Provider value={scrollableEnd}>
        {children}
      </ScrollableEndContext.Provider>
    </MessageScrollerContext.Provider>
  );
}

/**
 * The scrollport. It holds the transcript first and the composer dock last;
 * the content reads that order.
 */
export function MessageScrollerViewport({
  ref,
  children,
}: {
  /** Receives the node too: trays and file drops attach to the viewport. */
  readonly ref: (viewport: HTMLDivElement | null) => void;
  readonly children: ReactNode;
}): ReactElement {
  const viewStore = usePaneViewStateStore();
  const { paneId, sessionId, scrollEdgeThreshold, setViewport, setScrollableEnd } =
    useMessageScroller();

  const attach = useCallback(
    (viewport: HTMLDivElement | null): void => {
      setViewport(viewport);
      ref(viewport);
    },
    [ref, setViewport],
  );

  return (
    <div
      ref={attach}
      data-nyte-scrollport="balanced"
      {...props(messageScrollerStyles.viewport)}
      onScroll={(event) => {
        const element = event.currentTarget;
        const bottomPinned = isBottomPinned(element, scrollEdgeThreshold);
        setScrollableEnd(!bottomPinned);
        viewStore.updateSession(sessionId, paneId, (current) => ({
          ...current,
          scroll: { top: element.scrollTop, bottomPinned },
        }));
      }}
    >
      {children}
    </div>
  );
}

function setDataState(element: HTMLElement, name: string, active: boolean): void {
  const value = active ? "true" : "false";

  if (element.dataset[name] !== value) element.dataset[name] = value;
}

/**
 * The real user row stays sticky inside its anchor item. Mutating a data
 * state here avoids cloning the prompt or rerendering the transcript on
 * every scroll tick; React continues to own the row and its edit state.
 * An anchor's top comes from the virtualizer's cached item start plus the
 * item's gap padding, so a scroll tick reads no rects. The viewport also
 * learns whether its top edge is exposed, which is what decides the fade there.
 */
function syncStickyAnchor(
  scroll: HTMLDivElement,
  virtualizer: TranscriptVirtualizer,
  scrollEdgeThreshold: number,
): void {
  // The container only: the composer dock after it can hold another transcript.
  const container = scroll.firstElementChild;

  if (container === null) return;
  // Item starts are computed lazily; the total forces the cache current.
  virtualizer.getTotalSize();
  const rows = container.querySelectorAll<HTMLElement>("[data-sticky-user-message]");
  const candidates: StickyCandidate[] = [];
  const candidateRows: HTMLElement[] = [];

  for (const row of rows) {
    const anchor = row.closest<HTMLDivElement>("[data-scroll-anchor='true']");
    const content = anchor?.firstElementChild;

    const item =
      anchor === null
        ? undefined
        : virtualizer.measurementsCache[virtualizer.indexFromElement(anchor)];

    const eligible =
      content instanceof HTMLElement &&
      item !== undefined &&
      row.offsetHeight < scroll.clientHeight;

    setDataState(row, "stickyDisabled", !eligible);

    if (!eligible || !(content instanceof HTMLElement) || item === undefined) continue;
    candidates.push({ start: item.start + content.offsetTop, height: item.size });
    candidateRows.push(row);
  }

  const active = activeStickyCandidate(
    candidates,
    scroll.scrollTop,
    isBottomPinned(scroll, scrollEdgeThreshold),
  );

  const activeRow = active === undefined ? undefined : candidateRows[active];

  for (const row of rows) setDataState(row, "stickyActive", row === activeRow);
  setDataState(scroll, "topFade", scroll.scrollTop > 0 && activeRow === undefined);
}

/**
 * The virtualized rows. The virtualizer instance mutates in place and the
 * compiler bails out of memoizing whatever calls it, so this stays its own
 * memoized component. A session change replaces the scroller around it, so
 * each visit builds a virtualizer seeded from that session's last
 * measurements and offset rather than from whatever the previous chat left.
 */
export const MessageScrollerContent = memo(function MessageScrollerContent({
  items,
  ready,
  density,
  estimateSize,
  renderItem,
}: {
  readonly items: readonly MessageScrollerItem[];
  /** Whether the items have loaded. The persisted offset can only be restored
   * once the rows it was measured against exist, so the restore runs again
   * when a cold open finishes loading. */
  readonly ready: boolean;
  /** Heights remembered under another density describe different rows. */
  readonly density: ToolCallDensity;
  readonly estimateSize: (index: number) => number;
  readonly renderItem: (index: number) => ReactNode;
}): ReactElement {
  const viewStore = usePaneViewStateStore();
  const { paneId, sessionId, autoScroll, scrollEdgeThreshold, viewport } = useMessageScroller();

  const dockHeight = useRef(0);

  // What the last visit measured, read once: the virtualizer consults its
  // initial options only until the viewport reports. Items already measured
  // take their real height; the rest keep their estimate. A density switch
  // starts from estimates again.
  const [restore] = useState(() => {
    const { transcript, scroll } = viewStore.readSession(sessionId, paneId);
    const measurements = transcript.density === density ? transcript.measurements : [];
    const measured = new Map(measurements.map((item) => [item.key, item.size]));

    return {
      measurements: [...measurements],
      rect: transcript.viewport ?? { width: 0, height: 0 },
      offset: initialTranscriptOffset({
        sizes: items.map((item, index) => measured.get(item.messageId) ?? estimateSize(index)),
        viewportHeight: transcript.viewport?.height ?? 0,
        scroll,
      }),
    };
  });

  // The slack under the last row scales with the viewport, so the container
  // follows it. What the last visit measured carries the first paint until
  // the observer below reports this one.
  const [viewportHeight, setViewportHeight] = useState(restore.rect.height);
  // The key extractor is a dependency of the virtualizer's measurement memo;
  // a fresh closure per render would rebuild every item's layout.
  const getItemKey = useCallback((index: number) => items[index]?.messageId ?? index, [items]);

  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => viewport,
    estimateSize,
    getItemKey,
    // The virtualizer owns the container height and row tops, so a scroll tick
    // rerenders only when the visible range changes. `position` keeps `top`
    // so the sticky prompt pins to the viewport, not to a transformed row.
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    initialMeasurementsCache: restore.measurements,
    initialRect: restore.rect,
    initialOffset: restore.offset,
    overscan: OVERSCAN,
    paddingStart: TRANSCRIPT_PADDING_START,
    paddingEnd: transcriptPaddingEnd(viewportHeight),
    // Fires after every measurement and scroll: item starts may have moved
    // under the stuck prompt.
    onChange: (instance) => {
      if (viewport !== null) syncStickyAnchor(viewport, instance, scrollEdgeThreshold);
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
    // The container is the viewport's first child; the composer dock is its last.
    const container = viewport?.firstElementChild;

    if (viewport === null || !(container instanceof HTMLElement)) return undefined;
    const last = viewport.lastElementChild;
    const dock = last instanceof HTMLElement && last !== container ? last : undefined;
    dockHeight.current = dock?.offsetHeight ?? 0;
    const restored = viewStore.readSession(sessionId, paneId).scroll;

    // Restoration must go through the virtualizer so its scroll target moves
    // too; a direct scrollTop write is undone by its initial reconcile.
    if (restored.bottomPinned) virtualizer.scrollToEnd();
    else virtualizer.scrollToOffset(restored.top);

    // The commit effect below and the observer's initial delivery both sync
    // the sticky prompt, so no explicit sync is needed here.
    const sync = (): void => syncStickyAnchor(viewport, virtualizer, scrollEdgeThreshold);

    // Streamed text, late highlights, a growing composer, and a shrinking
    // viewport all move the bottom; a reader pinned there follows it. A
    // reader elsewhere keeps what they are looking at: the dock grows over
    // the content, so the content moves up by as much.
    const observer = new ResizeObserver((entries) => {
      const follow = autoScroll && viewStore.readSession(sessionId, paneId).scroll.bottomPinned;

      setViewportHeight(viewport.clientHeight);

      if (dock !== undefined && entries.some((entry) => entry.target === dock)) {
        const delta = dock.offsetHeight - dockHeight.current;
        dockHeight.current = dock.offsetHeight;

        if (!follow) virtualizer.scrollToOffset(viewport.scrollTop + delta);
      }

      if (follow) virtualizer.scrollToEnd();
      sync();
    });

    observer.observe(viewport);
    observer.observe(container);

    if (dock !== undefined) observer.observe(dock);
    viewport.addEventListener("scroll", sync, { passive: true });

    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", sync);
    };
  }, [autoScroll, paneId, ready, scrollEdgeThreshold, sessionId, viewStore, viewport, virtualizer]);

  // Rows have been measured by their refs by the time this runs, so the
  // prompt that should be stuck is decided against heights the reader sees.
  useLayoutEffect(() => {
    if (viewport !== null) syncStickyAnchor(viewport, virtualizer, scrollEdgeThreshold);
  }, [items, scrollEdgeThreshold, viewport, virtualizer]);

  return (
    <div ref={virtualizer.containerRef} {...props(messageScrollerStyles.content)}>
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index];

        if (item === undefined) return null;

        return (
          <div
            key={item.messageId}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            data-scroll-anchor={item.scrollAnchor}
            {...props(
              messageScrollerStyles.item,
              virtualItem.index === 0 && messageScrollerStyles.itemFirst,
            )}
          >
            {renderItem(virtualItem.index)}
          </div>
        );
      })}
    </div>
  );
});

/** Jumps to the latest message; absent while the reader is already there or outside a scroller. */
export function MessageScrollerButton(): ReactElement | null {
  const scroller = useContext(MessageScrollerContext);
  const scrollableEnd = useContext(ScrollableEndContext);

  if (scroller === null || !scrollableEnd) return null;

  return (
    <Button
      iconOnly
      icon="chevron-down"
      aria-label="Scroll to latest message"
      variant="outline"
      round
      onClick={() => {
        const { viewport } = scroller;

        if (viewport === null) return;
        viewport.scrollTo({ top: viewport.scrollHeight });
        scroller.setScrollableEnd(false);
      }}
      xstyle={messageScrollerStyles.button}
    />
  );
}
