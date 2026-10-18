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
import type { TranscriptRow } from "./transcript-rows.ts";
import {
  navigates,
  scrollsWithin,
  showScrollButton,
  syncSticky,
  topIn,
  TRANSCRIPT_PADDING_END,
  TRANSCRIPT_PADDING_START,
} from "./transcript-scroll.ts";

const OVERSCAN = 4;

type TranscriptVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

const VIEWPORT_GUESS = 800;

const SCROLL_EDGE_THRESHOLD = 60;

const MEASURED_TRANSCRIPTS = 16;

const measured = new Map<string, VirtualItem[]>();

type TranscriptItem = Pick<
  TranscriptRow,
  "messageId" | "scrollAnchor" | "group" | "leads" | "sticky"
>;

function readStickyRows(items: readonly TranscriptItem[]) {
  const above: number[] = [];
  const ends = new Map<number, number>();
  let sticky = -1;

  for (const [index, item] of items.entries()) {
    if (item.group === null || item.group !== items[index - 1]?.group) sticky = -1;

    if (item.sticky && item.group !== null) sticky = index;
    above.push(sticky);
  }

  let end = items.length - 1;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];

    if (item === undefined) continue;

    if (item.group === null || item.group !== items[index + 1]?.group) end = index;

    if (item.sticky && item.group !== null) ends.set(index, end);
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
  /** Keeps the element's row rendered while it scrolls out of view, until the returned release runs. */
  readonly keep: (element: Element) => () => void;
  readonly page: (direction: 1 | -1) => void;
}

interface TranscriptOptions {
  readonly paneId: PaneId;
  readonly sessionId: SessionId;
  readonly viewportRef?: (viewport: HTMLDivElement | null) => void;
  readonly onReachStart?: () => void;
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
  | Pick<TranscriptState, "paneId" | "sessionId" | "viewStore">
  | undefined {
  return useContext(TranscriptContext) ?? undefined;
}

export function TranscriptProvider({
  paneId,
  sessionId,
  viewportRef,
  onReachStart,
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
      onReachStart,
      viewStore,
      initialPosition,
      dock,
      setDock,
      controlsRef,
      controls,
    }),
    [controls, dock, initialPosition, onReachStart, paneId, sessionId, viewportRef, viewStore],
  );

  return <TranscriptContext value={transcript}>{children}</TranscriptContext>;
}

export const TranscriptContent = memo(function TranscriptContent({
  items,
  ready,
  estimateSize,
  renderItem,
}: {
  readonly items: readonly TranscriptItem[];
  readonly ready: boolean;
  readonly estimateSize: (index: number) => number;
  readonly renderItem: (index: number) => ReactNode;
}): ReactElement {
  const {
    paneId,
    sessionId,
    viewportRef,
    onReachStart,
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
  const sticky = useMemo(() => readStickyRows(items), [items]);

  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = stickyRange(range, sticky.above);

      if (kept.size === 0) return indexes;
      const rendered = new Set(indexes);

      for (const [index, item] of items.entries())
        if (kept.has(item.messageId)) rendered.add(index);

      return [...rendered].toSorted((first, second) => first - second);
    },
    [items, kept, sticky],
  );

  const [initialOffset] = useState(() => {
    let total = TRANSCRIPT_PADDING_START;

    for (let index = 0; index < items.length; index += 1) total += estimateSize(index);

    return Math.max(0, total - VIEWPORT_GUESS);
  });

  const getItemKey = useCallback(
    (index: number) => items[index]?.messageId ?? String(index),
    [items],
  );

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
    syncSticky(scroll, content.current, atEnd.current);
    showScrollButton(dock, left > SCROLL_EDGE_THRESHOLD);

    if (
      !opening.current &&
      scroll.scrollTop < scroll.clientHeight &&
      instance.range?.startIndex === 0
    )
      onReachStart?.();
  };

  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
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

  useLayoutEffect(() => stretchSpans(virtualizer, sticky.ends));

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

  const hold = (element: Element): void => {
    const key = element.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
    const scroll = virtualizer.scrollElement;

    if (key === undefined || scroll === null) return;
    virtualizer.cancelScroll();
    opening.current = false;
    const anchor = { key, element, top: topIn(scroll, element) };
    heldRef.current = anchor;
    flushSync(() => setHeld(anchor));
  };

  const keep = (element: Element): (() => void) => {
    const key = element.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;

    if (key === undefined) return ignore;
    setKept((current) => new Set(current).add(key));

    return () =>
      setKept((current) => {
        const next = new Set(current);
        next.delete(key);

        return next;
      });
  };

  const release = (): void => {
    virtualizer.cancelScroll();
    opening.current = false;

    if (heldRef.current === null) return;
    heldRef.current = null;
    setHeld(null);
  };

  const end = (): void => {
    release();
    virtualizer.scrollToEnd();
  };

  const restoreHeld = useEffectEvent((): void => {
    const anchor = heldRef.current;

    if (anchor === null) {
      virtualizer.scrollToEnd();

      return;
    }

    const index = items.findIndex((item) => item.messageId === anchor.key);

    if (anchor.element === undefined && index >= 0) {
      virtualizer.scrollToIndex(index, { align: "start" });
    }
  });

  useLayoutEffect(() => {
    if (ready) restoreHeld();
  }, [ready]);

  useLayoutEffect(() => {
    if (atEnd.current) virtualizer.scrollToEnd();
  }, [dockHeight, items, virtualizer]);

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
      end,
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
  });

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

      const row = (node instanceof Element ? node : node?.parentElement)?.closest(
        "[data-message-id]",
      );

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
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];

          if (item === undefined) return null;

          return (
            <div
              key={item.messageId}
              ref={virtualizer.measureElement}
              data-message-id={item.messageId}
              data-index={virtualItem.index}
              data-nyte-scroll-anchor={item.scrollAnchor}
              {...props(
                messageScrollerStyles.item,
                !item.leads && messageScrollerStyles.itemWithin,
                item.sticky && messageScrollerStyles.itemSticky,
                virtualItem.index === 0 && messageScrollerStyles.itemFirst,
              )}
            >
              {item.sticky ? (
                <div data-turn-span {...props(messageScrollerStyles.span)}>
                  {renderItem(virtualItem.index)}
                  <div aria-hidden />
                </div>
              ) : (
                renderItem(virtualItem.index)
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
