import { props } from "@stylexjs/stylex";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { Range, VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import type { SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Icon } from "@nyte-ai/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { flushSync } from "react-dom";
import { usePaneViewStateStore } from "../layout/pane-context.tsx";
import type { PaneId } from "../layout/pane-layout.ts";
import type { ScrollViewState } from "../layout/session-view-state.ts";
import { messageScrollerStyles } from "./transcript.stylex.ts";
import type { RowLayout } from "./transcript-rows.ts";
import {
  navigates,
  scrollsWithin,
  showScrollButton,
  syncSticky,
  topIn,
  TRANSCRIPT_PADDING_END,
  TRANSCRIPT_PADDING_START,
} from "./transcript-scroll.ts";

const OVERSCAN = 2;

const HISTORY_LEAD_SCREENS = 3;

type TranscriptVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

const VIEWPORT_GUESS = 800;

const SCROLL_EDGE_THRESHOLD = 60;

const MEASURED_TRANSCRIPTS = 16;

const measured = new Map<string, VirtualItem[]>();

function readStickyRows(rows: readonly RowLayout[]) {
  const above: number[] = [];
  const ends = new Map<number, number>();
  let sticky = -1;

  for (const [index, row] of rows.entries()) {
    if (row.group === null || row.group !== rows[index - 1]?.group) sticky = -1;

    if (row.sticky && row.group !== null) sticky = index;
    above.push(sticky);
  }

  let end = rows.length - 1;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];

    if (row === undefined) continue;

    if (row.group === null || row.group !== rows[index + 1]?.group) end = index;

    if (row.sticky && row.group !== null) ends.set(index, end);
  }

  return { above, ends };
}

function stickyRange(range: Range, above: readonly number[]): number[] {
  const indexes = defaultRangeExtractor(range);
  const held = above[range.startIndex] ?? -1;

  return held >= 0 && held < (indexes[0] ?? 0) ? [held, ...indexes] : indexes;
}

function stretchSpans(instance: TranscriptVirtualizer, ends: ReadonlyMap<number, number>): void {
  for (const item of instance.getVirtualItems()) {
    const last = ends.get(item.index);
    const span = instance.elementsCache.get(item.key)?.firstElementChild;
    const fill = span?.lastElementChild;
    const end = last === undefined ? undefined : instance.measurementsCache[last]?.end;

    if (end === undefined || !(span instanceof HTMLElement) || !(fill instanceof HTMLElement))
      continue;
    const extent = `${String(Math.max(0, end - item.end))}px`;

    if (fill.style.height === extent) continue;
    fill.style.height = extent;
    span.style.marginBottom = `-${extent}`;
  }
}

interface Anchor {
  readonly key: string;
  readonly element: Element | undefined;
  readonly top: number;
}

interface TranscriptControls {
  readonly end: () => void;
  readonly hold: (element: Element) => void;
  readonly keep: (element: Element) => () => void;
  readonly page: (direction: 1 | -1) => void;
}

interface TranscriptOptions {
  readonly paneId: PaneId;
  readonly sessionId: SessionId;
  readonly viewportRef?: (viewport: HTMLDivElement | null) => void;
  readonly loadEarlier?: () => Promise<number>;
}

interface TranscriptState extends TranscriptOptions {
  readonly viewStore: ReturnType<typeof usePaneViewStateStore>;
  readonly initialPosition: ScrollViewState;
  readonly dock: HTMLDivElement | null;
  readonly setDock: (dock: HTMLDivElement | null) => void;
  readonly controlsRef: RefObject<TranscriptControls | null>;
  readonly controls: TranscriptControls;
}

const ignore = (): void => {};

const NO_CONTROLS: TranscriptControls = {
  end: () => undefined,
  hold: () => undefined,
  keep: () => ignore,
  page: () => undefined,
};

const TranscriptContext = createContext<TranscriptState | null>(null);

function useTranscript(): TranscriptState {
  const transcript = useContext(TranscriptContext);

  if (transcript === null) throw new Error("Transcript parts need a TranscriptProvider");

  return transcript;
}

export function useTranscriptDock(): (dock: HTMLDivElement | null) => void {
  return useContext(TranscriptContext)?.setDock ?? ignore;
}

export function useTranscriptControls(): TranscriptControls {
  return useContext(TranscriptContext)?.controls ?? NO_CONTROLS;
}

export function useTranscriptScope():
  | Pick<TranscriptState, "paneId" | "sessionId" | "viewStore" | "loadEarlier">
  | undefined {
  return useContext(TranscriptContext) ?? undefined;
}

export function TranscriptProvider({
  paneId,
  sessionId,
  viewportRef,
  loadEarlier,
  children,
}: TranscriptOptions & { readonly children: ReactNode }): ReactElement {
  const viewStore = usePaneViewStateStore();

  const [initialPosition] = useState<ScrollViewState>(
    () => viewStore.readSession(sessionId, paneId).scroll[paneId] ?? { kind: "end" },
  );

  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const controlsRef = useRef<TranscriptControls | null>(null);

  const [controls] = useState((): TranscriptControls => ({
    end: () => controlsRef.current?.end(),
    hold: (element) => controlsRef.current?.hold(element),
    keep: (element) => controlsRef.current?.keep(element) ?? ignore,
    page: (direction) => controlsRef.current?.page(direction),
  }));

  const transcript = useMemo(
    () => ({
      paneId,
      sessionId,
      viewportRef,
      loadEarlier,
      viewStore,
      initialPosition,
      dock,
      setDock,
      controlsRef,
      controls,
    }),
    [controls, dock, initialPosition, loadEarlier, paneId, sessionId, viewportRef, viewStore],
  );

  return <TranscriptContext value={transcript}>{children}</TranscriptContext>;
}

export const TranscriptContent = memo(function TranscriptContent({
  rows,
  ready,
  estimateSize,
  renderRow,
}: {
  readonly rows: readonly RowLayout[];
  readonly ready: boolean;
  readonly estimateSize: (index: number) => number;
  readonly renderRow: (index: number) => ReactNode;
}): ReactElement {
  const {
    paneId,
    sessionId,
    viewportRef,
    loadEarlier,
    viewStore,
    initialPosition,
    dock,
    controlsRef,
  } = useTranscript();

  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [dockHeight, setDockHeight] = useState(0);

  const [held, setHeld] = useState<Anchor | null>(
    initialPosition.kind === "end"
      ? null
      : { key: initialPosition.key, element: undefined, top: initialPosition.offset },
  );

  const heldRef = useRef(held);
  const opening = useRef(initialPosition.kind === "end");
  const content = useRef<HTMLDivElement>(null);
  const scrollport = useRef<HTMLDivElement | null>(null);

  const measuredKey = `${sessionId}\u0000${paneId}`;
  const [initialMeasurements] = useState(() => measured.get(measuredKey) ?? []);
  const sticky = useMemo(() => readStickyRows(rows), [rows]);

  const indexes = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows]);

  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());

  const rangeExtractor = useCallback(
    (range: Range) => {
      const shown = stickyRange(range, sticky.above);

      if (kept.size === 0) return shown;
      const rendered = new Set(shown);

      for (const key of kept) {
        const index = indexes.get(key);

        if (index !== undefined) rendered.add(index);
      }

      return [...rendered].toSorted((first, second) => first - second);
    },
    [indexes, kept, sticky],
  );

  const [initialOffset] = useState(() => {
    let total = TRANSCRIPT_PADDING_START;

    for (let index = 0; index < rows.length; index += 1) total += estimateSize(index);

    return Math.max(0, total - VIEWPORT_GUESS);
  });

  const getItemKey = useCallback((index: number) => rows[index]?.key ?? String(index), [rows]);

  const correct = (instance: TranscriptVirtualizer): void => {
    const anchor = heldRef.current;
    const scroll = instance.scrollElement;
    const row = anchor === null ? undefined : instance.elementsCache.get(anchor.key);

    if (anchor === null || scroll === null || row === undefined) return;

    if (anchor.element !== undefined && !anchor.element.isConnected) {
      heldRef.current = { ...anchor, element: undefined, top: topIn(scroll, row) };

      return;
    }

    const drift = topIn(scroll, anchor.element ?? row) - anchor.top;

    if (Math.abs(drift) > 0.5) instance.scrollToOffset(scroll.scrollTop + drift);
  };

  const atEnd = useRef(initialPosition.kind === "end");
  const historyLoading = useRef(false);

  const loadHistory = (instance: TranscriptVirtualizer): void => {
    const scroll = instance.scrollElement;

    if (
      loadEarlier === undefined ||
      historyLoading.current ||
      opening.current ||
      scroll === null ||
      scroll.scrollTop >= scroll.clientHeight * HISTORY_LEAD_SCREENS
    )
      return;
    historyLoading.current = true;
    void loadEarlier()
      .finally(() => {
        historyLoading.current = false;
      })
      .then((loaded) => {
        if (loaded > 0) requestAnimationFrame(() => loadHistory(instance));
      });
  };

  const present = (instance: TranscriptVirtualizer, left = instance.getDistanceFromEnd()): void => {
    const scroll = instance.scrollElement;

    if (scroll === null || content.current === null) return;
    correct(instance);
    stretchSpans(instance, sticky.ends);

    if (opening.current && heldRef.current === null) {
      if (left <= 1) opening.current = false;
      else instance.scrollToEnd();
    }

    atEnd.current = heldRef.current === null && left <= 1;
    syncSticky(scroll, content.current);
    showScrollButton(dock, left > SCROLL_EDGE_THRESHOLD);
    loadHistory(instance);
  };

  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => viewport,
    estimateSize,
    getItemKey,
    initialOffset,
    initialMeasurementsCache: initialMeasurements,
    rangeExtractor,
    overscan: OVERSCAN,
    paddingStart: TRANSCRIPT_PADDING_START,
    paddingEnd: TRANSCRIPT_PADDING_END + dockHeight,
    anchorTo: "end",
    scrollEndThreshold: held === null ? 1 : -1,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    useFlushSync: false,
    onChange: (instance) => present(instance),
  });

  useLayoutEffect(() => {
    heldRef.current = held;
  }, [held]);

  const virtualRows = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const scroll = virtualizer.scrollElement;
    stretchSpans(virtualizer, sticky.ends);

    if (scroll !== null && content.current !== null) syncSticky(scroll, content.current);
  }, [sticky, virtualRows, virtualizer]);

  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const fold = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;

      return instance.itemSizeCache.has(item.key) ? item.end <= fold : item.start < fold;
    };
  }, [virtualizer]);

  const attachViewport = useCallback(
    (element: HTMLDivElement | null) => {
      scrollport.current = element;
      setViewport(element);
      viewportRef?.(element);
    },
    [viewportRef],
  );

  const hold = useCallback(
    (element: Element): void => {
      const key = element.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
      const scroll = virtualizer.scrollElement;

      if (key === undefined || scroll === null) return;
      virtualizer.cancelScroll();
      opening.current = false;
      const anchor = { key, element, top: topIn(scroll, element) };
      heldRef.current = anchor;
      flushSync(() => setHeld(anchor));
    },
    [virtualizer],
  );

  const keep = useCallback((element: Element): (() => void) => {
    const key = element.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;

    if (key === undefined) return ignore;
    setKept((current) => new Set(current).add(key));

    return () =>
      setKept((current) => {
        const next = new Set(current);
        next.delete(key);

        return next;
      });
  }, []);

  const release = useCallback((): void => {
    virtualizer.cancelScroll();
    opening.current = false;

    if (heldRef.current === null) return;
    heldRef.current = null;
    setHeld(null);
  }, [virtualizer]);

  const restoreHeld = useEffectEvent((): void => {
    const anchor = heldRef.current;

    if (anchor === null) {
      if (!atEnd.current) return;
      opening.current = true;
      virtualizer.scrollToEnd();

      return;
    }

    const index = indexes.get(anchor.key);

    if (anchor.element === undefined && index !== undefined) {
      virtualizer.scrollToIndex(index, { align: "start" });
    }
  });

  useLayoutEffect(() => {
    if (ready) restoreHeld();
  }, [ready]);

  useLayoutEffect(() => {
    if (atEnd.current) virtualizer.scrollToEnd();
  }, [dockHeight, rows, virtualizer]);

  useLayoutEffect(
    () => () => {
      const scroll = scrollport.current;
      const anchor = heldRef.current;
      const rows = [...virtualizer.elementsCache.entries()];

      const top =
        scroll === null
          ? undefined
          : rows
              .filter(
                ([, row]) =>
                  row.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top,
              )
              .sort(
                ([, first], [, second]) =>
                  virtualizer.indexFromElement(first) - virtualizer.indexFromElement(second),
              )[0];

      const row = anchor === null ? top : (rows.find(([key]) => key === anchor.key) ?? top);

      const atEnd =
        scroll !== null && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 1;

      const position: ScrollViewState =
        scroll !== null && row !== undefined && (anchor !== null || !atEnd)
          ? { kind: "anchor", key: String(row[0]), offset: topIn(scroll, row[1]) }
          : { kind: "end" };

      viewStore.updateSession(sessionId, paneId, (state) => ({
        ...state,
        scroll: { ...state.scroll, [paneId]: position },
      }));
      measured.delete(measuredKey);
      measured.set(measuredKey, virtualizer.takeSnapshot());

      for (const key of measured.keys()) {
        if (measured.size <= MEASURED_TRANSCRIPTS) break;
        measured.delete(key);
      }
    },
    [measuredKey, paneId, sessionId, viewStore, virtualizer],
  );

  useLayoutEffect(() => {
    if (viewport === null) return undefined;

    controlsRef.current = {
      end: () => {
        release();
        virtualizer.scrollToEnd();
      },
      hold,
      keep,
      page: (direction) => {
        release();
        virtualizer.scrollBy(direction * viewport.clientHeight * 0.9);
      },
    };

    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, hold, keep, release, viewport, virtualizer]);

  const holdRow = useEffectEvent(hold);
  const releaseHeld = useEffectEvent(release);
  const presentRows = useEffectEvent((left?: number): void => present(virtualizer, left));

  useLayoutEffect(() => {
    const scroll = viewport;

    if (scroll === null) return undefined;
    let height = scroll.clientHeight;

    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === dock) {
          setDockHeight(entry.target.getBoundingClientRect().height);
        } else if (entry.target === scroll) {
          const shrunk = Math.max(0, height - scroll.clientHeight);
          height = scroll.clientHeight;
          const left = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;

          if (heldRef.current === null && left <= shrunk + 1) virtualizer.scrollToEnd();
          presentRows(Math.min(left, shrunk + 1 >= left ? 0 : left));

          return;
        }
      }

      presentRows();
    });

    resize.observe(scroll);

    if (dock !== null) {
      setDockHeight(dock.getBoundingClientRect().height);
      resize.observe(dock);
    }

    const pressed = (event: PointerEvent): void => {
      if (event.target === scroll) releaseHeld();
    };

    const keyed = (event: KeyboardEvent): void => {
      if (navigates(event)) releaseHeld();
    };

    const clicked = (event: MouseEvent): void => {
      const control =
        event.target instanceof Element
          ? event.target.closest("[aria-expanded], [data-step-preview] *")
          : null;

      if (control !== null) holdRow(control);
    };

    const selected = (): void => {
      const selection = document.getSelection();
      const node = selection?.anchorNode;
      const anchor = heldRef.current;

      const row = (node instanceof Element ? node : node?.parentElement)?.closest("[data-row-key]");

      if (
        selection?.isCollapsed === false &&
        row instanceof Element &&
        content.current?.contains(row) === true &&
        anchor?.element !== row
      )
        holdRow(row);
    };

    const wheeledDock = (event: WheelEvent): void => {
      if (dock === null || scrollsWithin(event.target, dock)) return;
      releaseHeld();
      virtualizer.scrollBy(event.deltaY);
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    scroll.addEventListener("scroll", () => presentRows(), { passive: true, signal });
    scroll.addEventListener("wheel", () => releaseHeld(), { passive: true, signal });
    scroll.addEventListener("touchmove", () => releaseHeld(), { passive: true, signal });
    scroll.addEventListener("pointerdown", pressed, { signal });
    scroll.addEventListener("keydown", keyed, { signal });
    content.current?.addEventListener("click", clicked, { capture: true, signal });
    document.addEventListener("selectionchange", selected, { signal });
    dock?.addEventListener("wheel", wheeledDock, { passive: true, signal });

    return () => {
      listeners.abort();
      resize.disconnect();
    };
  }, [dock, viewport, virtualizer]);

  return (
    <div
      ref={attachViewport}
      role="region"
      aria-label="Messages"
      tabIndex={-1}
      data-nyte-scrollport="balanced"
      {...props(messageScrollerStyles.viewport)}
    >
      <div
        ref={(element) => {
          content.current = element;
          virtualizer.containerRef(element);
        }}
        {...props(text.lg, messageScrollerStyles.content)}
      >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];

          if (row === undefined) return null;

          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-row-key={row.key}
              data-index={virtualRow.index}
              data-nyte-scroll-anchor={row.scrollAnchor}
              {...props(
                messageScrollerStyles.item,
                !row.leads && messageScrollerStyles.itemWithin,
                row.sticky && messageScrollerStyles.itemSticky,
                virtualRow.index === 0 && messageScrollerStyles.itemFirst,
              )}
            >
              {row.sticky ? (
                <div data-turn-span {...props(messageScrollerStyles.span)}>
                  {renderRow(virtualRow.index)}
                  <div aria-hidden />
                </div>
              ) : (
                renderRow(virtualRow.index)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export function TranscriptButton(): ReactElement | null {
  const transcript = useContext(TranscriptContext);
  const scrollButton = props(messageScrollerStyles.buttonControl);

  if (transcript === null) return null;

  return (
    <div
      aria-hidden
      data-slot="scroll-to-bottom"
      data-scroll-shown="false"
      {...props(messageScrollerStyles.button)}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              iconOnly
              aria-label="Scroll to bottom"
              tabIndex={-1}
              className={scrollButton.className}
              style={scrollButton.style}
              onClick={(event) => {
                event.currentTarget.blur();
                transcript.controlsRef.current?.end();
              }}
            >
              <Icon name="arrow-down" size={14} />
            </Button>
          }
        />
        <TooltipContent side="top">Scroll to bottom</TooltipContent>
      </Tooltip>
    </div>
  );
}
