import { props } from "@stylexjs/stylex";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
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
import type { ReactElement, ReactNode, RefObject } from "react";
import { flushSync } from "react-dom";
import { usePaneViewStateStore } from "../layout/pane-context.tsx";
import type { PaneId } from "../layout/pane-layout.ts";
import type { ScrollViewState } from "../layout/session-view-state.ts";
import { messageScrollerStyles } from "./styles.stylex.ts";
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

/** The scrollport's height before it has one, for the first window. */
const VIEWPORT_GUESS = 800;

/** Far enough above the end for the scroll-to-bottom button to show. */
const SCROLL_EDGE_THRESHOLD = 60;

/**
 * What Reading holds still: an element and its distance below the
 * scrollport's top, or the row `key` names when there is no element yet.
 */
interface Anchor {
  readonly key: string;
  readonly element: Element | undefined;
  readonly top: number;
}

interface TranscriptControls {
  readonly end: () => void;
  readonly hold: (element: Element) => void;
}

interface TranscriptOptions {
  readonly paneId: PaneId;
  readonly sessionId: SessionId;
  /** Receives the scrollport, which the composer's trays and file drops use. */
  readonly viewportRef?: (viewport: HTMLDivElement | null) => void;
}

interface TranscriptState extends TranscriptOptions {
  readonly viewStore: ReturnType<typeof usePaneViewStateStore>;
  readonly initialPosition: ScrollViewState;
  readonly dock: HTMLDivElement | null;
  readonly setDock: (dock: HTMLDivElement | null) => void;
  readonly controlsRef: RefObject<TranscriptControls | null>;
}

const TranscriptContext = createContext<TranscriptState | null>(null);

function useTranscript(): TranscriptState {
  const transcript = useContext(TranscriptContext);

  if (transcript === null) throw new Error("Transcript parts need a TranscriptProvider");

  return transcript;
}

const ignore = (): void => {};

export function useTranscriptDock(): (dock: HTMLDivElement | null) => void {
  return useContext(TranscriptContext)?.setDock ?? ignore;
}

/** Hold an element where it is on screen, or go to the end and follow it. */
export function useTranscriptControls(): TranscriptControls {
  const controlsRef = useContext(TranscriptContext)?.controlsRef;

  return {
    end: () => controlsRef?.current?.end(),
    hold: (element) => controlsRef?.current?.hold(element),
  };
}

/** The session the enclosing transcript draws and the pane view-state slot it saves into. */
export function useTranscriptScope():
  | Pick<TranscriptState, "paneId" | "sessionId" | "viewStore">
  | undefined {
  return useContext(TranscriptContext) ?? undefined;
}

export function TranscriptProvider({
  paneId,
  sessionId,
  viewportRef,
  children,
}: TranscriptOptions & { readonly children: ReactNode }): ReactElement {
  const viewStore = usePaneViewStateStore();

  const [initialPosition] = useState<ScrollViewState>(
    () => viewStore.readSession(sessionId, paneId).scroll[paneId] ?? { kind: "end" },
  );

  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const controlsRef = useRef<TranscriptControls | null>(null);

  const transcript = useMemo(
    () => ({
      paneId,
      sessionId,
      viewportRef,
      viewStore,
      initialPosition,
      dock,
      setDock,
      controlsRef,
    }),
    [dock, initialPosition, paneId, sessionId, viewportRef, viewStore],
  );

  return <TranscriptContext value={transcript}>{children}</TranscriptContext>;
}

export const TranscriptContent = memo(function TranscriptContent({
  items,
  ready,
  estimateSize,
  renderItem,
}: {
  readonly items: readonly Pick<TranscriptRow, "messageId" | "scrollAnchor">[];
  readonly ready: boolean;
  readonly estimateSize: (index: number) => number;
  readonly renderItem: (index: number) => ReactNode;
}): ReactElement {
  const { paneId, sessionId, viewportRef, viewStore, initialPosition, dock, controlsRef } =
    useTranscript();

  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [dockHeight, setDockHeight] = useState(0);

  const [held, setHeld] = useState<Anchor | null>(
    initialPosition.kind === "end"
      ? null
      : { key: initialPosition.key, element: undefined, top: initialPosition.offset },
  );

  const heldRef = useRef(held);
  /** Reopening at the end chases it while the first rows measure, until it gets there. */
  const opening = useRef(initialPosition.kind === "end");
  const content = useRef<HTMLDivElement>(null);
  const scrollport = useRef<HTMLDivElement | null>(null);
  const indexOf = (key: string): number => items.findIndex((item) => item.messageId === key);

  const [initialOffset] = useState(() => {
    let total = TRANSCRIPT_PADDING_START;

    for (let index = 0; index < items.length; index += 1) total += estimateSize(index);

    return Math.max(0, total - VIEWPORT_GUESS);
  });

  const getItemKey = useCallback(
    (index: number) => items[index]?.messageId ?? String(index),
    [items],
  );

  /** The hold's drift after TanStack laid rows out; its row stands in for a lost element. */
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

  /** Whether the view was at the end the last time it settled; rows changing keep it there. */
  const atEnd = useRef(initialPosition.kind === "end");

  const present = (instance: TranscriptVirtualizer, left = instance.getDistanceFromEnd()): void => {
    const scroll = instance.scrollElement;

    if (scroll === null || content.current === null) return;
    correct(instance);

    if (opening.current && heldRef.current === null) {
      if (left <= 1) opening.current = false;
      else instance.scrollToEnd();
    }

    atEnd.current = heldRef.current === null && left <= 1;
    syncSticky(scroll, content.current, atEnd.current);
    showScrollButton(dock, left > SCROLL_EDGE_THRESHOLD);
  };

  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => viewport,
    estimateSize,
    getItemKey,
    initialOffset,
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

  /** Rule 10: rows above the fold are compensated, even while the reader scrolls up. */
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

  /** Rules 1 and 20: reopen at the end, or jump to the saved row for `correct` to place. */
  useLayoutEffect(() => {
    if (!ready) return;
    const anchor = heldRef.current;

    if (anchor === null) {
      virtualizer.scrollToEnd();
    } else if (anchor.element === undefined && indexOf(anchor.key) >= 0) {
      virtualizer.scrollToIndex(indexOf(anchor.key), { align: "start" });
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once the thread's rows exist
  }, [ready]);

  /**
   * Rules 2 and 15: rows joining (the live sentinel stays last, so TanStack
   * sees no append) and a composer changing height keep Following at the end.
   */
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
    },
    [paneId, sessionId, viewStore, virtualizer],
  );

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
          present(virtualizer, Math.min(left, shrunk + 1 >= left ? 0 : left));

          return;
        }
      }

      present(virtualizer);
    });

    resize.observe(scroll);

    if (dock !== null) {
      setDockHeight(dock.getBoundingClientRect().height);
      resize.observe(dock);
    }

    controlsRef.current = { end, hold };

    const pressed = (event: PointerEvent): void => {
      if (event.target === scroll) release();
    };

    const keyed = (event: KeyboardEvent): void => {
      if (navigates(event)) release();
    };

    const clicked = (event: MouseEvent): void => {
      const control =
        event.target instanceof Element
          ? event.target.closest("[aria-expanded], [data-step-preview] *")
          : null;

      if (control !== null) hold(control);
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
        hold(row);
    };

    const wheeledDock = (event: WheelEvent): void => {
      if (dock === null || scrollsWithin(event.target, dock)) return;
      release();
      virtualizer.scrollBy(event.deltaY);
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    scroll.addEventListener("scroll", () => present(virtualizer), { passive: true, signal });
    scroll.addEventListener("wheel", release, { passive: true, signal });
    scroll.addEventListener("touchmove", release, { passive: true, signal });
    scroll.addEventListener("pointerdown", pressed, { signal });
    scroll.addEventListener("keydown", keyed, { signal });
    content.current?.addEventListener("click", clicked, { capture: true, signal });
    document.addEventListener("selectionchange", selected, { signal });
    dock?.addEventListener("wheel", wheeledDock, { passive: true, signal });

    return () => {
      listeners.abort();
      resize.disconnect();
      controlsRef.current = null;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the handlers read live state through refs
  }, [controlsRef, dock, viewport, virtualizer]);

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
        role="log"
        {...props(messageScrollerStyles.content)}
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
                virtualItem.index === 0 && messageScrollerStyles.itemFirst,
              )}
            >
              {renderItem(virtualItem.index)}
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
