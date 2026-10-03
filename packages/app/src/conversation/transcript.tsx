import { props } from "@stylexjs/stylex";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { SessionId } from "@nyte-ai/protocol";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  MessageScrollerProvider,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
} from "@nyte-ai/ui/message-scroller";
import type { MessageScrollerScrollOptions } from "@nyte-ai/ui/message-scroller";
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
import { usePaneViewStateStore } from "../layout/pane-context.tsx";
import type { PaneId } from "../layout/pane-layout.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { messageScrollerStyles } from "./styles.stylex.ts";
import type { TranscriptRow } from "./transcript-rows.ts";
import {
  activeStickyCandidate,
  initialTranscriptOffset,
  isBottomPinned,
  TRANSCRIPT_PADDING_END,
  TRANSCRIPT_PADDING_START,
} from "./transcript-scroll.ts";
import type { StickyCandidate } from "./transcript-scroll.ts";

const OVERSCAN = 4;

type TranscriptVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

type ScrollToRow = (messageId: string, options?: MessageScrollerScrollOptions) => boolean;

interface TranscriptOptions {
  readonly paneId: PaneId;
  readonly sessionId: SessionId;
  readonly ready: boolean;
  readonly autoScroll: boolean;
  readonly scrollEdgeThreshold: number;
}

interface TranscriptState extends TranscriptOptions {
  readonly viewStore: ReturnType<typeof usePaneViewStateStore>;
  readonly initialView: ReturnType<ReturnType<typeof usePaneViewStateStore>["readSession"]>;
  readonly viewport: HTMLDivElement | null;
  readonly setViewport: (viewport: HTMLDivElement | null) => void;
  readonly dock: HTMLDivElement | null;
  readonly setDock: (dock: HTMLDivElement | null) => void;
  readonly navigation: RefObject<ScrollToRow | null>;
  readonly hold: (holding: boolean) => void;
}

const TranscriptContext = createContext<TranscriptState | null>(null);

function useTranscript(): TranscriptState {
  const transcript = useContext(TranscriptContext);

  if (transcript === null) throw new Error("Transcript parts need a TranscriptProvider");

  return transcript;
}

export function useTranscriptDock() {
  const transcript = useContext(TranscriptContext);
  const setDock = transcript?.setDock;

  return useCallback((dock: HTMLDivElement | null) => setDock?.(dock), [setDock]);
}

export function useTranscriptNavigation() {
  const { navigation } = useTranscript();

  return useMemo(
    () => ({
      scrollToRow: (messageId: string, options?: MessageScrollerScrollOptions) =>
        navigation.current?.(messageId, options) ?? false,
    }),
    [navigation],
  );
}

const REMEMBERED_WORK_GROUPS = 64;

function rememberWorkGroup(
  current: ReadonlyMap<string, boolean>,
  key: string,
  open: boolean,
  liveKey: string | undefined,
): ReadonlyMap<string, boolean> {
  const groups = new Map(current);

  if (liveKey !== undefined) groups.delete(liveKey);
  groups.delete(key);
  groups.set(key, open);

  for (const oldest of groups.keys()) {
    if (groups.size <= REMEMBERED_WORK_GROUPS) break;
    groups.delete(oldest);
  }

  return groups;
}

export function useWorkGroupOpen(
  groupKey: string | undefined,
  liveKey: string | undefined,
): readonly [boolean | undefined, (open: boolean) => void] {
  const transcript = useContext(TranscriptContext);
  const key = groupKey === "" ? undefined : groupKey;

  const [open, setOpen] = useState(() => {
    if (transcript === null || key === undefined) return undefined;

    const groups = transcript.viewStore.readSession(
      transcript.sessionId,
      transcript.paneId,
    ).workGroups;

    return groups.get(key) ?? (liveKey === undefined ? undefined : groups.get(liveKey));
  });

  const change = (next: boolean): void => {
    setOpen(next);

    if (transcript === null || key === undefined) return;
    transcript.viewStore.updateSession(transcript.sessionId, transcript.paneId, (current) => ({
      ...current,
      workGroups: rememberWorkGroup(current.workGroups, key, next, liveKey),
    }));
  };

  useLayoutEffect(() => {
    if (transcript === null || key === undefined || liveKey === undefined) return;
    transcript.viewStore.updateSession(transcript.sessionId, transcript.paneId, (current) => {
      const adopted = current.workGroups.get(liveKey);

      return adopted === undefined
        ? current
        : {
            ...current,
            workGroups: rememberWorkGroup(
              current.workGroups,
              key,
              current.workGroups.get(key) ?? adopted,
              liveKey,
            ),
          };
    });
  }, [key, liveKey, transcript]);

  return [open, change];
}

export function TranscriptProvider({
  paneId,
  sessionId,
  ready,
  autoScroll,
  scrollEdgeThreshold,
  children,
}: TranscriptOptions & { readonly children: ReactNode }): ReactElement {
  const viewStore = usePaneViewStateStore();
  const [initialView] = useState(() => viewStore.readSession(sessionId, paneId));
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const navigation = useRef<ScrollToRow | null>(null);
  const [holding, hold] = useState(false);

  const transcript = useMemo(
    () => ({
      paneId,
      sessionId,
      ready,
      autoScroll: autoScroll && ready,
      scrollEdgeThreshold,
      viewStore,
      initialView,
      viewport,
      setViewport,
      dock,
      setDock,
      navigation,
      hold,
    }),
    [
      autoScroll,
      dock,
      initialView,
      navigation,
      paneId,
      ready,
      scrollEdgeThreshold,
      sessionId,
      viewport,
      viewStore,
    ],
  );

  return (
    <MessageScrollerProvider
      autoScroll={autoScroll && ready && !holding}
      defaultScrollPosition={initialView.scroll.bottomPinned ? "end" : "start"}
      scrollEdgeThreshold={scrollEdgeThreshold}
    >
      <TranscriptContext value={transcript}>{children}</TranscriptContext>
    </MessageScrollerProvider>
  );
}

export function TranscriptViewport({
  ref,
  children,
}: {
  readonly ref: (viewport: HTMLDivElement | null) => void;
  readonly children: ReactNode;
}): ReactElement {
  const viewStore = usePaneViewStateStore();
  const { paneId, sessionId, scrollEdgeThreshold, setViewport } = useTranscript();

  const attach = useCallback(
    (viewport: HTMLDivElement | null): void => {
      setViewport(viewport);
      ref(viewport);
    },
    [ref, setViewport],
  );

  return (
    <MessageScrollerViewport
      ref={attach}
      tabIndex={-1}
      preserveScrollOnPrepend={false}
      data-nyte-scrollport="balanced"
      {...props(messageScrollerStyles.viewport)}
      onScroll={(event) => {
        const element = event.currentTarget;
        const bottomPinned = isBottomPinned(element, scrollEdgeThreshold);
        viewStore.updateSession(sessionId, paneId, (current) => ({
          ...current,
          scroll: { top: element.scrollTop, bottomPinned },
        }));
      }}
    >
      {children}
    </MessageScrollerViewport>
  );
}

const ANCHOR_SETTLE_MS = 150;

const ANCHOR_LIMIT_MS = 1000;

interface ContentFloor {
  held: number;
  paused: boolean;
  transient: number;
  total: number;
  top: number;
  anchoring: boolean;
  frame: number;
}

function viewportEdge(scroll: HTMLDivElement, content: HTMLElement): number {
  return content.offsetHeight - (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight);
}

function applyFloor(content: HTMLElement, floor: ContentFloor): void {
  const height = Math.max(floor.held, floor.transient);
  content.style.minHeight = height > 0 ? `${height}px` : "";
}

function setDataState(element: HTMLElement, name: string, active: boolean): void {
  const value = active ? "true" : "false";

  if (element.dataset[name] !== value) element.dataset[name] = value;
}

function syncStickyAnchor(
  scroll: HTMLDivElement,
  container: HTMLDivElement,
  virtualizer: TranscriptVirtualizer,
  scrollEdgeThreshold: number,
): void {
  virtualizer.getTotalSize();
  const rows = container.querySelectorAll<HTMLElement>("[data-sticky-user-message]");
  const candidates: StickyCandidate[] = [];
  const candidateRows: HTMLElement[] = [];

  for (const row of rows) {
    const anchor = row.closest<HTMLDivElement>("[data-nyte-scroll-anchor='true']");
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

export const TranscriptContent = memo(function TranscriptContent({
  items,
  ready,
  density,
  estimateSize,
  renderItem,
}: {
  readonly items: readonly Pick<TranscriptRow, "messageId" | "scrollAnchor">[];
  readonly ready: boolean;
  readonly density: ToolCallDensity;
  readonly estimateSize: (index: number) => number;
  readonly renderItem: (index: number) => ReactNode;
}): ReactElement {
  const viewStore = usePaneViewStateStore();

  const {
    paneId,
    sessionId,
    initialView,
    autoScroll,
    scrollEdgeThreshold,
    viewport,
    dock,
    navigation,
    hold,
  } = useTranscript();

  const { scrollToEnd, scrollToMessage } = useMessageScroller();
  const scrollable = useMessageScrollerScrollable();
  const scrollableRef = useRef(scrollable);
  scrollableRef.current = scrollable;
  const container = useRef<HTMLDivElement>(null);
  const extent = useRef<HTMLDivElement>(null);
  const dockHeight = useRef(0);

  const floor = useRef<ContentFloor>({
    held: 0,
    paused: false,
    transient: 0,
    total: 0,
    top: 0,
    anchoring: false,
    frame: 0,
  });

  const pendingNavigation = useRef<{
    readonly messageId: string;
    readonly options: MessageScrollerScrollOptions | undefined;
  } | null>(null);

  const [restore] = useState(() => {
    const { transcript, scroll } = initialView;
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

  const getItemKey = useCallback((index: number) => items[index]?.messageId ?? index, [items]);

  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => viewport,
    estimateSize,
    getItemKey,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    initialMeasurementsCache: restore.measurements,
    initialRect: restore.rect,
    initialOffset: restore.offset,
    overscan: OVERSCAN,
    paddingStart: TRANSCRIPT_PADDING_START,
    paddingEnd: TRANSCRIPT_PADDING_END,
    onChange: (instance) => {
      const total = instance.getTotalSize();
      const bounds = floor.current;

      const content = container.current;

      if (content !== null && total < bounds.total) {
        if (bounds.anchoring || scrollableRef.current.end) {
          bounds.held = Math.max(bounds.held, bounds.total);
        }

        bounds.transient = Math.max(bounds.transient, bounds.total);
        applyFloor(content, bounds);
        window.cancelAnimationFrame(bounds.frame);
        bounds.frame = window.requestAnimationFrame(() => {
          bounds.transient = 0;
          applyFloor(content, bounds);
        });
      } else if (content !== null && bounds.held > 0 && total >= bounds.held) {
        bounds.held = 0;
        applyFloor(content, bounds);
      }

      bounds.total = total;

      if (extent.current !== null) {
        extent.current.style.top = `${total + dockHeight.current}px`;
      }

      if (viewport !== null && container.current !== null) {
        syncStickyAnchor(viewport, container.current, instance, scrollEdgeThreshold);
      }
    },
  });

  const attachContainer = useCallback(
    (element: HTMLDivElement | null) => {
      container.current = element;
      virtualizer.containerRef(element);
    },
    [virtualizer],
  );

  useLayoutEffect(() => {
    navigation.current = (messageId, options) => {
      const index = items.findIndex((item) => item.messageId === messageId);

      if (index < 0) return false;
      const mounting = pendingNavigation.current !== null;
      pendingNavigation.current = null;

      if (!mounting && scrollToMessage(messageId, options)) return true;
      pendingNavigation.current = { messageId, options };
      virtualizer.scrollToIndex(index, {
        align: options?.align === "nearest" ? "auto" : (options?.align ?? "start"),
        behavior: "auto",
      });

      return true;
    };
  }, [items, navigation, scrollToMessage, virtualizer]);

  useLayoutEffect(
    () => () => {
      navigation.current = null;
      pendingNavigation.current = null;
    },
    [navigation],
  );

  useLayoutEffect(() => {
    const pending = pendingNavigation.current;

    if (pending === null) return;

    if (!items.some((item) => item.messageId === pending.messageId)) {
      pendingNavigation.current = null;

      return;
    }

    if (!virtualizer.isScrolling && scrollToMessage(pending.messageId, pending.options)) {
      pendingNavigation.current = null;
    }
  });

  useLayoutEffect(
    () => () => {
      const measurements = virtualizer.takeSnapshot();
      viewStore.updateSession(sessionId, paneId, (current) =>
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
    if (viewport === null || container.current === null) return;

    if (initialView.scroll.bottomPinned) {
      virtualizer.scrollToEnd();
      scrollToEnd({ behavior: "auto" });
    } else {
      virtualizer.scrollToOffset(initialView.scroll.top);
    }
  }, [initialView, ready, scrollToEnd, viewport, virtualizer]);

  useLayoutEffect(() => {
    const content = container.current;

    if (viewport === null || content === null) return undefined;
    dockHeight.current = dock?.offsetHeight ?? 0;

    const sync = (): void => {
      if (extent.current !== null) {
        extent.current.style.top = `${virtualizer.getTotalSize() + dockHeight.current}px`;
      }

      syncStickyAnchor(viewport, content, virtualizer, scrollEdgeThreshold);
    };

    sync();

    const observer = new ResizeObserver((entries) => {
      if (dock !== null && entries.some((entry) => entry.target === dock)) {
        const delta = dock.offsetHeight - dockHeight.current;
        dockHeight.current = dock.offsetHeight;
        sync();

        if (scrollableRef.current.end || !autoScroll) {
          virtualizer.scrollToOffset(viewport.scrollTop + delta);
        } else {
          scrollToEnd({ behavior: "auto" });
        }
      }

      sync();
    });

    observer.observe(viewport);
    observer.observe(content);

    if (dock !== null) observer.observe(dock);
    viewport.addEventListener("scroll", sync, { passive: true });

    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", sync);
    };
  }, [autoScroll, dock, scrollEdgeThreshold, scrollToEnd, viewport, virtualizer]);

  useLayoutEffect(() => {
    const content = container.current;

    if (viewport === null || content === null) return undefined;
    const state = floor.current;
    let release = (): void => {};

    let gesture: Event | undefined;

    const settle = (keepVisible: boolean): void => {
      const edge = viewportEdge(viewport, content);
      state.held = keepVisible && edge > virtualizer.getTotalSize() ? edge : 0;
      applyFloor(content, state);
    };

    const keep = (): void => {
      const up = viewport.scrollTop < state.top;
      state.top = viewport.scrollTop;

      if (!state.anchoring && state.held > 0) settle(up);

      if (!state.anchoring && state.paused) {
        state.paused = false;
        hold(false);
      }
    };

    const anchor = (event: MouseEvent): void => {
      const control =
        event.target instanceof Element
          ? event.target.closest("[aria-expanded], [data-work-preview] *")
          : null;

      if (control === null || (gesture !== undefined && gesture.eventPhase !== Event.NONE)) return;
      gesture = event;
      release();
      viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      hold(true);
      state.paused = false;
      state.held = viewportEdge(viewport, content);
      state.anchoring = true;
      applyFloor(content, state);

      const anchors = [control, control.closest("[data-index]")].flatMap((element) =>
        element === null ? [] : [{ element, top: element.getBoundingClientRect().top }],
      );

      const started = performance.now();
      let timer = 0;

      const correct = (): void => {
        const pinned = anchors.find(({ element }) => element.isConnected);

        const drift =
          pinned === undefined ? 0 : pinned.element.getBoundingClientRect().top - pinned.top;

        if (Math.abs(drift) > 0.5) viewport.scrollTop += drift;
        window.clearTimeout(timer);
        timer = window.setTimeout(
          release,
          performance.now() - started < ANCHOR_LIMIT_MS ? ANCHOR_SETTLE_MS : 0,
        );
      };

      const observer = new ResizeObserver(correct);
      content.addEventListener("scroll", correct, { capture: true, passive: true });

      release = () => {
        observer.disconnect();
        content.removeEventListener("scroll", correct, { capture: true });
        window.clearTimeout(timer);
        release = () => {};

        state.anchoring = false;
        settle(true);
        const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        state.paused = distance >= 1 && distance <= scrollEdgeThreshold;

        if (!state.paused) hold(false);
      };

      for (
        let node = control.parentElement;
        node !== null && node !== viewport;
        node = node.parentElement
      ) {
        observer.observe(node);
      }

      timer = window.setTimeout(release, ANCHOR_SETTLE_MS);
    };

    content.addEventListener("click", anchor, { capture: true });
    viewport.addEventListener("scroll", keep, { passive: true });

    return () => {
      release();
      state.paused = false;
      hold(false);
      window.cancelAnimationFrame(state.frame);
      content.removeEventListener("click", anchor, { capture: true });
      viewport.removeEventListener("scroll", keep);
    };
  }, [hold, scrollEdgeThreshold, viewport, virtualizer]);

  useLayoutEffect(() => {
    if (viewport !== null && container.current !== null) {
      syncStickyAnchor(viewport, container.current, virtualizer, scrollEdgeThreshold);
    }
  }, [items, scrollEdgeThreshold, viewport, virtualizer]);

  return (
    <MessageScrollerContent ref={attachContainer} {...props(messageScrollerStyles.content)}>
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index];

        if (item === undefined) return null;

        return (
          <MessageScrollerItem
            key={item.messageId}
            ref={virtualizer.measureElement}
            messageId={item.messageId}
            data-index={virtualItem.index}
            data-nyte-scroll-anchor={item.scrollAnchor}
            {...props(
              messageScrollerStyles.item,
              virtualItem.index === 0 && messageScrollerStyles.itemFirst,
            )}
          >
            {renderItem(virtualItem.index)}
          </MessageScrollerItem>
        );
      })}
      <div
        ref={extent}
        aria-hidden="true"
        data-transcript-extent=""
        style={{ position: "absolute", height: 0, width: 0 }}
      />
    </MessageScrollerContent>
  );
});

function TranscriptScrollButton(): ReactElement {
  const scrollable = useMessageScrollerScrollable();
  const scrollButton = props(messageScrollerStyles.buttonControl);

  return (
    <div
      aria-hidden={!scrollable.end}
      data-slot="scroll-to-bottom"
      data-scroll-shown={scrollable.end}
      {...props(
        messageScrollerStyles.button,
        scrollable.end ? messageScrollerStyles.buttonShown : messageScrollerStyles.buttonHidden,
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MessageScrollerButton
              behavior="auto"
              render={
                <Button
                  iconOnly
                  round
                  aria-label="Scroll to bottom"
                  className={scrollButton.className}
                  style={scrollButton.style}
                />
              }
            >
              <Icon name="arrow-down" size={14} />
            </MessageScrollerButton>
          }
        />
        <TooltipContent side="top">Scroll to bottom</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function TranscriptButton(): ReactElement | null {
  const transcript = useContext(TranscriptContext);

  return transcript === null ? null : <TranscriptScrollButton />;
}
