import { props } from "@stylexjs/stylex";
import { elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { SessionId } from "@nyte-ai/protocol";
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
import { usePaneViewStateStore } from "../layout/pane-context.tsx";
import type { PaneId } from "../layout/pane-layout.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { messageScrollerStyles } from "./styles.stylex.ts";
import type { TranscriptRow } from "./transcript-rows.ts";
import {
  activeStickyCandidate,
  distanceFromEnd,
  initialTranscriptOffset,
  isAtEnd,
  TRANSCRIPT_PADDING_END,
  TRANSCRIPT_PADDING_START,
} from "./transcript-scroll.ts";
import type { StickyCandidate } from "./transcript-scroll.ts";

const OVERSCAN = 4;

type TranscriptVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

export interface TranscriptScrollOptions {
  readonly align?: "start" | "center" | "end" | "nearest";
  readonly behavior?: ScrollBehavior;
}

type ScrollToRow = (messageId: string, options?: TranscriptScrollOptions) => boolean;

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
  /** The content's way to the real bottom; it also resumes following. */
  readonly end: RefObject<(() => void) | null>;
  /** Whether the reader rides the bottom. Only the content flips it. */
  readonly following: RefObject<boolean>;
  readonly setAway: (away: boolean) => void;
}

const TranscriptContext = createContext<TranscriptState | null>(null);

/** Far enough above the bottom for the scroll-to-bottom button to show. */
const TranscriptAwayContext = createContext(false);

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
      scrollToRow: (messageId: string, options?: TranscriptScrollOptions) =>
        navigation.current?.(messageId, options) ?? false,
    }),
    [navigation],
  );
}

const REMEMBERED_STEP_GROUPS = 64;

function rememberStepGroup(
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
    if (groups.size <= REMEMBERED_STEP_GROUPS) break;
    groups.delete(oldest);
  }

  return groups;
}

export function useStepGroupOpen(
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
    ).stepGroups;

    return groups.get(key) ?? (liveKey === undefined ? undefined : groups.get(liveKey));
  });

  const change = (next: boolean): void => {
    setOpen(next);

    if (transcript === null || key === undefined) return;
    transcript.viewStore.updateSession(transcript.sessionId, transcript.paneId, (current) => ({
      ...current,
      stepGroups: rememberStepGroup(current.stepGroups, key, next, liveKey),
    }));
  };

  useLayoutEffect(() => {
    if (transcript === null || key === undefined || liveKey === undefined) return;
    transcript.viewStore.updateSession(transcript.sessionId, transcript.paneId, (current) => {
      const adopted = current.stepGroups.get(liveKey);

      return adopted === undefined
        ? current
        : {
            ...current,
            stepGroups: rememberStepGroup(
              current.stepGroups,
              key,
              current.stepGroups.get(key) ?? adopted,
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
  const end = useRef<(() => void) | null>(null);
  const following = useRef(initialView.scroll.bottomPinned);
  const [away, setAway] = useState(false);

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
      end,
      following,
      setAway,
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
    <TranscriptContext value={transcript}>
      <TranscriptAwayContext value={away}>{children}</TranscriptAwayContext>
    </TranscriptContext>
  );
}

export function TranscriptViewport({
  ref,
  children,
}: {
  readonly ref: (viewport: HTMLDivElement | null) => void;
  readonly children: ReactNode;
}): ReactElement {
  const { setViewport } = useTranscript();

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
      role="region"
      aria-label="Messages"
      tabIndex={-1}
      data-nyte-scrollport="balanced"
      {...props(messageScrollerStyles.viewport)}
    >
      {children}
    </div>
  );
}

const ANCHOR_SETTLE_MS = 150;

const ANCHOR_LIMIT_MS = 1000;

interface ContentFloor {
  transient: number;
  total: number;
  frame: number;
}

function applyFloor(content: HTMLElement, floor: ContentFloor): void {
  content.style.minHeight = floor.transient > 0 ? `${floor.transient}px` : "";
}

function setDataState(element: HTMLElement, name: string, active: boolean): void {
  const value = active ? "true" : "false";

  if (element.dataset[name] !== value) element.dataset[name] = value;
}

function syncStickyAnchor(
  scroll: HTMLDivElement,
  container: HTMLDivElement,
  virtualizer: TranscriptVirtualizer,
  following: boolean,
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

  const active = activeStickyCandidate(candidates, scroll.scrollTop, following);

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
    end,
    following,
    setAway,
  } = useTranscript();

  const container = useRef<HTMLDivElement>(null);
  const anchoring = useRef(false);
  /** The last scroll offset written by code, so its scroll event is not read as intent. */
  const written = useRef<number | null>(null);
  const settle = useRef<() => void>(() => {});
  const floor = useRef<ContentFloor>({ transient: 0, total: 0, frame: 0 });

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
    scrollToFn: (offset, options, instance) => {
      written.current = offset + (options.adjustments ?? 0);
      elementScroll(offset, options, instance);
    },
    onChange: (instance) => {
      const total = instance.getTotalSize();
      const bounds = floor.current;

      const content = container.current;

      if (content !== null && total < bounds.total) {
        bounds.transient = Math.max(bounds.transient, bounds.total);
        applyFloor(content, bounds);
        window.cancelAnimationFrame(bounds.frame);
        bounds.frame = window.requestAnimationFrame(() => {
          bounds.transient = 0;
          applyFloor(content, bounds);
        });
      }

      bounds.total = total;
      settle.current();
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
      following.current = false;
      virtualizer.scrollToIndex(index, {
        align: options?.align === "nearest" ? "auto" : (options?.align ?? "start"),
        behavior: options?.behavior ?? "auto",
      });

      return true;
    };

    return () => {
      navigation.current = null;
    };
  }, [following, items, navigation, virtualizer]);

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
    const content = container.current;

    if (viewport === null || content === null) return undefined;

    const pin = (): void => {
      const bottom = viewport.scrollHeight - viewport.clientHeight;

      if (viewport.scrollTop === bottom) return;
      written.current = bottom;
      viewport.scrollTop = bottom;
    };

    let extent = -1;

    settle.current = () => {
      const next = viewport.scrollHeight - viewport.clientHeight;

      if (autoScroll && following.current && next !== extent) pin();
      extent = next;
      syncStickyAnchor(viewport, content, virtualizer, following.current);
      setAway(distanceFromEnd(viewport) > scrollEdgeThreshold);
    };

    end.current = () => {
      following.current = autoScroll;
      pin();
      settle.current();
    };

    let lastTop = viewport.scrollTop;
    const scrollable = (): boolean => viewport.scrollHeight > viewport.clientHeight;

    const scrolled = (): void => {
      const top = viewport.scrollTop;
      const own = written.current !== null && Math.abs(top - written.current) < 1.5;
      written.current = null;

      if (!own && !anchoring.current) {
        if (isAtEnd(viewport)) following.current = autoScroll;
        else if (top < lastTop) following.current = false;
      }

      lastTop = top;
      settle.current();
      viewStore.updateSession(sessionId, paneId, (current) => ({
        ...current,
        scroll: { top, bottomPinned: following.current },
      }));
    };

    const wheeled = (event: WheelEvent): void => {
      if (!scrollable()) return;

      if (event.deltaY < 0) following.current = false;
      else if (event.deltaY > 0 && isAtEnd(viewport)) following.current = autoScroll;
    };

    const keyed = (event: KeyboardEvent): void => {
      const upward =
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        (event.key === " " && event.shiftKey);

      const editing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target.closest("input, textarea, select, [contenteditable]") !== null);

      if (upward && !editing && !event.defaultPrevented && scrollable()) following.current = false;
    };

    const observer = new ResizeObserver(() => settle.current());
    observer.observe(viewport);
    observer.observe(content);

    if (dock !== null) observer.observe(dock);
    viewport.addEventListener("scroll", scrolled, { passive: true });
    viewport.addEventListener("wheel", wheeled, { passive: true });
    viewport.addEventListener("keydown", keyed);
    settle.current();

    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", scrolled);
      viewport.removeEventListener("wheel", wheeled);
      viewport.removeEventListener("keydown", keyed);
      settle.current = () => {};

      end.current = null;
    };
  }, [
    autoScroll,
    dock,
    end,
    following,
    paneId,
    scrollEdgeThreshold,
    sessionId,
    setAway,
    viewStore,
    viewport,
    virtualizer,
  ]);

  useLayoutEffect(() => {
    if (viewport === null || container.current === null) return;

    if (initialView.scroll.bottomPinned) {
      end.current?.();
    } else {
      following.current = false;
      virtualizer.scrollToOffset(initialView.scroll.top);
    }
  }, [end, following, initialView, ready, viewport, virtualizer]);

  useLayoutEffect(() => {
    const content = container.current;

    if (viewport === null || content === null) return undefined;
    const bounds = floor.current;
    let release = (): void => {};

    let gesture: Event | undefined;

    const anchor = (event: MouseEvent): void => {
      const control =
        event.target instanceof Element
          ? event.target.closest("[aria-expanded], [data-step-preview] *")
          : null;

      if (control === null || (gesture !== undefined && gesture.eventPhase !== Event.NONE)) return;
      gesture = event;
      release();
      following.current = false;
      anchoring.current = true;

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

        anchoring.current = false;

        if (isAtEnd(viewport)) following.current = autoScroll;
        settle.current();
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

    return () => {
      release();
      window.cancelAnimationFrame(bounds.frame);
      content.removeEventListener("click", anchor, { capture: true });
    };
  }, [autoScroll, following, viewport]);

  useLayoutEffect(() => {
    settle.current();
  }, [items]);

  return (
    <div ref={attachContainer} role="log" {...props(messageScrollerStyles.content)}>
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
  );
});

function TranscriptScrollButton(): ReactElement {
  const { end } = useTranscript();
  const away = useContext(TranscriptAwayContext);
  const scrollButton = props(messageScrollerStyles.buttonControl);

  return (
    <div
      aria-hidden={!away}
      data-slot="scroll-to-bottom"
      data-scroll-shown={away}
      {...props(
        messageScrollerStyles.button,
        away ? messageScrollerStyles.buttonShown : messageScrollerStyles.buttonHidden,
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              iconOnly
              round
              aria-label="Scroll to bottom"
              tabIndex={away ? undefined : -1}
              className={scrollButton.className}
              style={scrollButton.style}
              onClick={(event) => {
                event.currentTarget.blur();
                end.current?.();
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

export function TranscriptButton(): ReactElement | null {
  const transcript = useContext(TranscriptContext);

  return transcript === null ? null : <TranscriptScrollButton />;
}
