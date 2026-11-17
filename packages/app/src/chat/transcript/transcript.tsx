import { props } from "@stylexjs/stylex";
import {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  useVirtualizer,
} from "@tanstack/react-virtual";
import type { Range, VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import type { SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Icon } from "@nyte-ai/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  createContext,
  useContext,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
// oxlint-disable-next-line no-restricted-imports -- useVirtualizer keeps TranscriptContent out of the compiler, so its virtualizer options stay memoized by hand
import { useCallback, useMemo } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { flushSync } from "react-dom";
import { usePaneViewStateStore } from "../../panes/pane-context.tsx";
import type { PaneId } from "../../panes/layout.ts";
import type { ScrollViewState } from "../../panes/session-view-state.ts";
import { messageScrollerStyles } from "./transcript.stylex.ts";
import {
  adjustsOnResize,
  IDLE_HISTORY,
  initialScroll,
  nextHistory,
  nextMode,
  NO_INPUT,
  sampleScroll,
  settleScroll,
  touchScroll,
  wroteScroll,
} from "./transcript-mode.ts";
import type {
  HistoryEvent,
  HistoryPager,
  HistoryTop,
  TranscriptScroll,
} from "./transcript-mode.ts";
import { DockInput, ViewportInput } from "./transcript-input.tsx";
import { EARLIER_ROW, stickySpans } from "./transcript-rows.ts";
import type { RowLayout } from "./transcript-rows.ts";
import {
  distanceFromEnd,
  frameHasInput,
  revealDistance,
  syncScrollButton,
  syncSticky,
  topIn,
  TRANSCRIPT_PADDING_END,
  TRANSCRIPT_PADDING_START,
} from "./transcript-scroll.ts";

const OVERSCAN = 2;

const HISTORY_LEAD_SCREENS = 3;

type TranscriptVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

const VIEWPORT_GUESS = 800;

const END_GAP_SHARE = 0.17;

const MEASURED_TRANSCRIPTS = 16;

const measured = new Map<SessionId, { readonly width: number; readonly items: VirtualItem[] }>();

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

interface TranscriptControls {
  readonly end: () => void;
  readonly hold: (element: Element) => void;
  readonly keep: (element: Element) => () => void;
  readonly page: (direction: 1 | -1) => void;
  readonly reveal: (element: Element) => void;
  readonly history: () => void;
}

interface TranscriptOptions {
  readonly paneId: PaneId;
  readonly sessionId: SessionId;
  readonly viewportRef?: (viewport: HTMLDivElement | null) => void;
  readonly loadEarlier?: () => Promise<number>;
  readonly focusComposer?: () => void;
}

interface TranscriptState extends TranscriptOptions {
  readonly viewStore: ReturnType<typeof usePaneViewStateStore>;
  readonly initialPosition: ScrollViewState;
  readonly dock: HTMLDivElement | null;
  readonly setDock: (dock: HTMLDivElement | null) => void;
  readonly controlsRef: RefObject<TranscriptControls | null>;
  readonly controls: TranscriptControls;
  readonly historyStalled: boolean;
  readonly setHistoryStalled: (stalled: boolean) => void;
}

const ignore = (): void => {};

const NO_CONTROLS: TranscriptControls = {
  end: () => undefined,
  hold: () => undefined,
  keep: () => ignore,
  page: () => undefined,
  reveal: () => undefined,
  history: () => undefined,
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
  | Pick<TranscriptState, "paneId" | "sessionId" | "viewStore" | "loadEarlier" | "historyStalled">
  | undefined {
  return useContext(TranscriptContext) ?? undefined;
}

export function TranscriptProvider({
  paneId,
  sessionId,
  viewportRef,
  loadEarlier,
  focusComposer,
  children,
}: TranscriptOptions & { readonly children: ReactNode }): ReactElement {
  const viewStore = usePaneViewStateStore();

  const [initialPosition] = useState<ScrollViewState>(
    () => viewStore.readSession(sessionId).scroll[paneId] ?? { kind: "end" },
  );

  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const controlsRef = useRef<TranscriptControls | null>(null);

  const [controls] = useState((): TranscriptControls => ({
    end: () => controlsRef.current?.end(),
    hold: (element) => controlsRef.current?.hold(element),
    keep: (element) => controlsRef.current?.keep(element) ?? ignore,
    page: (direction) => controlsRef.current?.page(direction),
    reveal: (element) => controlsRef.current?.reveal(element),
    history: () => controlsRef.current?.history(),
  }));

  const [historyStalled, setHistoryStalled] = useState(false);

  const transcript = {
    paneId,
    sessionId,
    viewportRef,
    loadEarlier,
    focusComposer,
    viewStore,
    initialPosition,
    dock,
    setDock,
    controlsRef,
    controls,
    historyStalled,
    setHistoryStalled,
  };

  return <TranscriptContext value={transcript}>{children}</TranscriptContext>;
}

export function TranscriptContent({
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
    setHistoryStalled,
  } = useTranscript();

  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(VIEWPORT_GUESS);

  const position = useRef<TranscriptScroll>(initialScroll(initialPosition));
  const content = useRef<HTMLDivElement>(null);
  const scrollport = useRef<HTMLDivElement | null>(null);
  const width = useRef<number>(undefined);

  const [initialMeasurements] = useState(() => measured.get(sessionId));
  const sticky = useMemo(() => stickySpans(rows), [rows]);

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

  const settle = (instance: TranscriptVirtualizer): void => {
    const scroll = instance.scrollElement;

    if (scroll === null) return;
    const mode = position.current.mode;
    const anchor = mode.kind === "reading" ? mode.anchor : null;
    const row = anchor === null ? undefined : instance.elementsCache.get(anchor.key);
    const connected = anchor?.element === undefined || anchor.element.isConnected;

    const settled = settleScroll(position.current, {
      now: performance.now(),
      distance: distanceFromEnd(scroll),
      ready,
      anchor:
        anchor === null
          ? null
          : {
              connected,
              rowTop: row === undefined ? undefined : topIn(scroll, row),
              elementTop:
                anchor.element === undefined || !connected
                  ? undefined
                  : topIn(scroll, anchor.element),
            },
    });

    position.current = settled.state;

    if (settled.action.kind === "end") instance.scrollToEnd();

    if (settled.action.kind === "offset")
      instance.scrollToOffset(scroll.scrollTop + settled.action.by);
  };

  const history = useRef<HistoryPager>(IDLE_HISTORY);

  const historyTop = useMemo(
    (): HistoryTop => ({
      top: rows[0]?.key,
      older: rows.some((row) => row.key.startsWith(EARLIER_ROW)),
    }),
    [rows],
  );

  const shownTop = useRef(historyTop);

  const pageHistory = (event: HistoryEvent): void => {
    if (loadEarlier === undefined) return;
    const step = nextHistory(history.current, event);

    if (step.pager.stalled !== history.current.stalled) setHistoryStalled(step.pager.stalled);
    history.current = step.pager;

    if (step.action === "next-frame") requestAnimationFrame(() => loadHistory(virtualizer));

    if (step.action === "load")
      void loadEarlier().then(
        (count) => pageHistory({ kind: "loaded", count }),
        () => pageHistory({ kind: "failed", now: performance.now() }),
      );
  };

  const loadHistory = (instance: TranscriptVirtualizer): void => {
    const scroll = instance.scrollElement;
    const mode = position.current.mode;

    if (scroll === null) return;
    pageHistory({
      kind: "present",
      nearTop: scroll.scrollTop < scroll.clientHeight * HISTORY_LEAD_SCREENS,
      opening: mode.kind === "following" && mode.opening,
      now: performance.now(),
      ...shownTop.current,
    });
  };

  const present = (
    instance: TranscriptVirtualizer,
    options: { readonly history: boolean },
  ): void => {
    const scroll = instance.scrollElement;
    shownTop.current = historyTop;
    stretchSpans(instance, sticky.ends);

    if (scroll === null || content.current === null) return;
    const opening = position.current.mode.kind === "following" && position.current.mode.opening;
    width.current = scroll.clientWidth;
    settle(instance);
    syncSticky(scroll, content.current, sticky.handovers);
    queueMicrotask(() => syncScrollButton(scroll, dock));

    if (
      options.history ||
      (opening && position.current.mode.kind === "following" && !position.current.mode.opening)
    )
      loadHistory(instance);
  };

  const queued = useRef<{ readonly history: boolean } | null>(null);

  const presentQueued = (): void => {
    const pending = queued.current;

    if (pending === null) return;
    queued.current = null;
    present(virtualizer, pending);
  };

  const queuePresent = (history: boolean): void => {
    const pending = queued.current;
    queued.current = { history: history || pending?.history === true };

    if (pending === null) queueMicrotask(presentQueued);
  };

  const presentNow = (history: boolean): void => {
    queued.current = { history: history || queued.current?.history === true };
    presentQueued();
  };

  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => viewport,
    observeElementOffset: (instance, onOffset) =>
      observeElementOffset(instance, (offset, scrolling) => {
        const scroll = instance.scrollElement;

        if (scroll !== null) {
          const sampled = sampleScroll(position.current, {
            offset,
            height: scroll.scrollHeight,
            clientHeight: scroll.clientHeight,
            frameInput: frameHasInput(scroll),
            now: performance.now(),
          });

          if (sampled.cancel) instance.cancelScroll();
          position.current = sampled.state;
        }

        flushSync(() => onOffset(offset, scrolling));
      }),
    scrollToFn: (offset, options, instance) => {
      const scroll = instance.scrollElement;

      if (scroll !== null)
        position.current = wroteScroll(
          position.current,
          offset + (options.adjustments ?? 0),
          scroll.scrollHeight - scroll.clientHeight,
        );
      elementScroll(offset, options, instance);

      if (scroll !== null) queueMicrotask(() => syncScrollButton(scroll, dock));
    },
    estimateSize,
    getItemKey,
    initialOffset,
    initialMeasurementsCache: initialMeasurements?.items ?? [],
    rangeExtractor,
    overscan: OVERSCAN,
    paddingStart: TRANSCRIPT_PADDING_START,
    paddingEnd:
      Math.min(
        TRANSCRIPT_PADDING_END,
        2 * Math.floor((Math.max(0, viewportHeight - dockHeight) * END_GAP_SHARE) / 2),
      ) + dockHeight,
    anchorTo: "end",
    scrollEndThreshold: -1,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    useFlushSync: false,
    onChange: () => queuePresent(true),
  });

  const measureRow = useCallback(
    (node: HTMLDivElement | null): void => {
      virtualizer.measureElement(node);

      if (node === null) return;
      const index = virtualizer.indexFromElement(node);
      const key = virtualizer.options.getItemKey(index);

      if (!virtualizer.itemSizeCache.has(key))
        virtualizer.resizeItem(
          index,
          virtualizer.options.measureElement(node, undefined, virtualizer),
        );
    },
    [virtualizer],
  );

  const attachContent = useCallback(
    (element: HTMLDivElement | null): void => {
      content.current = element;
      virtualizer.containerRef(element);
    },
    [virtualizer],
  );

  const virtualRows = virtualizer.getVirtualItems();
  const lastPainted = useRef(false);

  const presentRows = useEffectEvent((): void => {
    presentNow(false);

    if (lastPainted.current || !ready || virtualRows.at(-1)?.index !== rows.length - 1) return;
    lastPainted.current = true;
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () =>
        performance.mark("nyte:last-message-painted", { detail: sessionId });
      channel.port2.postMessage(null);
    });
  });

  const askHistory = useEffectEvent((): void => pageHistory({ kind: "asked", ...historyTop }));

  // oxlint-disable-next-line nyte-code/no-direct-effect -- drops sizes measured at another width before the first present reads them
  useLayoutEffect(() => {
    if (
      viewport !== null &&
      initialMeasurements !== undefined &&
      viewport.clientWidth !== initialMeasurements.width
    )
      virtualizer.measure();
  }, [initialMeasurements, viewport, virtualizer]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures virtual rows and syncs sticky headers before paint
  useLayoutEffect(() => {
    presentRows();
  }, [dock, dockHeight, ready, sticky, viewportHeight, virtualRows, virtualizer]);

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
      position.current = {
        ...position.current,
        mode: nextMode(position.current.mode, {
          kind: "held",
          anchor: { key, element, top: topIn(scroll, element) },
        }),
      };
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

  const touch = useCallback(
    (upward: boolean): void => {
      virtualizer.cancelScroll();
      position.current = touchScroll(position.current, upward, performance.now());
    },
    [virtualizer],
  );

  const press = useCallback((pressed: boolean): void => {
    position.current = { ...position.current, input: { ...position.current.input, pressed } };
  }, []);

  const restoreAnchor = useEffectEvent((): void => {
    const mode = position.current.mode;
    const anchor = mode.kind === "reading" ? mode.anchor : null;

    if (anchor === null || anchor.element !== undefined) return;
    const index = indexes.get(anchor.key);

    if (index !== undefined) virtualizer.scrollToIndex(index, { align: "start" });
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- restores the reading anchor before paint once rows are ready
  useLayoutEffect(() => {
    if (ready && viewport !== null) restoreAnchor();
  }, [ready, viewport]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- saves virtualizer measurements to the view store on unmount
  useLayoutEffect(
    () => () => {
      const scroll = scrollport.current;
      const current = position.current.mode;
      const anchor = current.kind === "reading" ? current.anchor : null;
      const rows = [...virtualizer.elementsCache.entries()];

      const topRow = (viewport: HTMLDivElement) => {
        const edge = viewport.getBoundingClientRect().top;

        return rows
          .filter(([, element]) => element.getBoundingClientRect().bottom > edge)
          .sort(
            ([, first], [, second]) =>
              virtualizer.indexFromElement(first) - virtualizer.indexFromElement(second),
          )[0];
      };

      const row =
        scroll === null || current.kind !== "reading"
          ? undefined
          : (rows.find(([key]) => key === anchor?.key) ?? topRow(scroll));

      const saved: ScrollViewState =
        scroll !== null && row !== undefined
          ? { kind: "anchor", key: String(row[0]), offset: topIn(scroll, row[1]) }
          : { kind: "end" };

      viewStore.updateSession(sessionId, (state) => ({
        ...state,
        scroll: { ...state.scroll, [paneId]: saved },
      }));
      measured.delete(sessionId);

      if (width.current !== undefined)
        measured.set(sessionId, { width: width.current, items: virtualizer.takeSnapshot() });

      for (const key of measured.keys()) {
        if (measured.size <= MEASURED_TRANSCRIPTS) break;
        measured.delete(key);
      }
    },
    [paneId, sessionId, viewStore, virtualizer],
  );

  // oxlint-disable-next-line nyte-code/no-direct-effect -- installs the virtualizer's scroll adjustment before it measures, and publishes scroll controls for the current viewport
  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
      adjustsOnResize(
        position.current.mode,
        { start: item.start, end: item.end, measured: instance.itemSizeCache.has(item.key) },
        instance.scrollOffset ?? 0,
      );

    if (viewport === null) return undefined;

    controlsRef.current = {
      end: () => {
        virtualizer.cancelScroll();
        position.current = {
          ...position.current,
          input: { ...NO_INPUT, pressed: position.current.input.pressed },
          mode: nextMode(position.current.mode, { kind: "ended" }),
        };
        virtualizer.scrollToEnd();
      },
      hold,
      keep,
      page: (direction) => {
        touch(direction < 0);
        virtualizer.scrollBy(direction * viewport.clientHeight * 0.9);
      },
      history: () => askHistory(),
      reveal: (element) => {
        const by = revealDistance(viewport, element);

        if (by === 0) return;
        const mode = position.current.mode;
        virtualizer.scrollToOffset(viewport.scrollTop + by);

        if (mode.kind === "reading" && mode.anchor !== null)
          position.current = {
            ...position.current,
            mode: nextMode(mode, {
              kind: "held",
              anchor: { ...mode.anchor, top: mode.anchor.top - by },
            }),
          };
      },
    };

    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, hold, keep, touch, viewport, virtualizer]);

  const selectRow = (): void => {
    const selection = document.getSelection();
    const node = selection?.anchorNode;
    const current = position.current.mode;
    const anchor = current.kind === "reading" ? current.anchor : null;

    const row = (node instanceof Element ? node : node?.parentElement)?.closest("[data-row-key]");

    if (
      selection?.isCollapsed === false &&
      row instanceof Element &&
      content.current?.contains(row) === true &&
      anchor?.element !== row
    )
      hold(row);
  };

  return (
    <div {...props(messageScrollerStyles.frame)}>
      <div
        ref={attachViewport}
        role="region"
        aria-label="Messages"
        tabIndex={-1}
        data-nyte-scrollport="balanced"
        {...props(
          messageScrollerStyles.viewport,
          dockHeight > 0 && messageScrollerStyles.docked(dockHeight),
        )}
      >
        {viewport !== null && (
          <ViewportInput
            viewport={viewport}
            content={content}
            onPresent={() => presentNow(true)}
            onResize={(height) => {
              flushSync(() => setViewportHeight(height));
              presentNow(true);
            }}
            onHold={hold}
            onInput={touch}
            onPress={press}
            onSelectionChange={selectRow}
          />
        )}
        {viewport !== null && dock !== null && (
          <DockInput
            dock={dock}
            onResize={(height) => {
              setDockHeight(height);
              presentNow(true);
            }}
            onWheel={(delta) => {
              touch(delta < 0);
              virtualizer.scrollBy(delta);
            }}
          />
        )}
        <div ref={attachContent} {...props(text.lg, messageScrollerStyles.content)}>
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];

            if (row === undefined) return null;

            return (
              <div
                key={row.key}
                ref={measureRow}
                data-row-key={row.key}
                data-index={virtualRow.index}
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
    </div>
  );
}

export function TranscriptButton(): ReactElement | null {
  const transcript = useContext(TranscriptContext);

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
              variant="outline"
              pill
              iconOnly
              aria-label="Scroll to bottom"
              tabIndex={-1}
              onClick={() => {
                transcript.controlsRef.current?.end();
                transcript.focusComposer?.();
              }}
            >
              <Icon name="arrow-down" size="sm" />
            </Button>
          }
        />
        <TooltipContent side="top">Scroll to bottom</TooltipContent>
      </Tooltip>
    </div>
  );
}
