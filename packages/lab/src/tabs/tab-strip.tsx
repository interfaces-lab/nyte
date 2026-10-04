/**
 * The window's tab strip, with opencode's drag rules: a tab moves after 4px
 * (8 on touch), only along the strip and only inside it; the close button
 * never starts a drag; picking a tab up selects it; the drop lands without an
 * animation; Escape cancels; and the strip scrolls near its edges. Pinned tabs
 * hold their place, so they neither move nor take a dragged tab.
 */
import { create, props } from "@stylexjs/stylex";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { Button } from "@nyte-ai/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@nyte-ai/ui/context-menu";
import { Icon } from "@nyte-ai/ui/icon";
import { button, radius } from "@nyte-ai/ui/schema.stylex";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { currentPlace, currentView, tabPlace, type Tab, type WindowAction } from "./model";
import { PlaceGlyph, placeInfo } from "./place";
import { stripStyles as styles } from "./tabs.stylex";

const keycapStyles = create({
  shortcut: { display: "inline-flex", alignItems: "center", gap: 8 },
  keys: { display: "inline-flex", gap: 3 },
  keycap: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: button.height2xs,
    paddingInline: 5,
    borderRadius: radius.control,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    transitionProperty: "background-color, color",
    transitionDuration: "80ms",
  },
  held: { backgroundColor: role.bgInteractivePrimaryTranslucent, color: role.contentPrimary },
});

const ACTIVATION_DISTANCE = { mouse: 4, touch: 8 } as const;

/** The share of the strip's width at each edge that scrolls it during a drag. */
const AUTO_SCROLL_EDGE = 0.05;

const AUTO_SCROLL_STEP = 8;

interface HeldKeys {
  readonly primary: boolean;
  readonly digit: string | undefined;
}

/** ⌘ lights while held and the digit while pressed, so the tooltip answers the hand. */
function useHeldKeys(): HeldKeys {
  const [held, setHeld] = useState<HeldKeys>({ primary: false, digit: undefined });

  useEffect(() => {
    const read = (event: KeyboardEvent): void => {
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];

      setHeld({
        primary: event.metaKey || event.ctrlKey,
        digit: event.type === "keydown" ? digit : undefined,
      });
    };
    const clear = (): void => setHeld({ primary: false, digit: undefined });

    window.addEventListener("keydown", read);
    window.addEventListener("keyup", read);
    window.addEventListener("blur", clear);

    return () => {
      window.removeEventListener("keydown", read);
      window.removeEventListener("keyup", read);
      window.removeEventListener("blur", clear);
    };
  }, []);

  return held;
}

interface Press {
  readonly tabId: string;
  readonly pointerId: number;
  readonly clientX: number;
  readonly distance: number;
}

/** Positions are in the list's scrolled content, so a scroll mid-drag cannot shift the maths. */
interface Drag {
  readonly tabId: string;
  readonly order: readonly string[];
  readonly lefts: ReadonlyMap<string, number>;
  readonly widths: ReadonlyMap<string, number>;
  readonly gap: number;
  readonly grabAt: number;
  readonly offset: number;
  readonly target: number;
}

function contentX(list: HTMLElement, clientX: number): number {
  return clientX - list.getBoundingClientRect().left + list.scrollLeft;
}

function startDrag(
  list: HTMLElement,
  items: ReadonlyMap<string, HTMLElement>,
  order: readonly string[],
  press: Press,
): Drag | undefined {
  const listLeft = list.getBoundingClientRect().left - list.scrollLeft;
  const lefts = new Map<string, number>();
  const widths = new Map<string, number>();

  for (const id of order) {
    const rect = items.get(id)?.getBoundingClientRect();

    if (rect === undefined) return undefined;
    lefts.set(id, rect.left - listLeft);
    widths.set(id, rect.width);
  }

  const [first, second] = order;
  const gap =
    first === undefined || second === undefined
      ? 0
      : (lefts.get(second) ?? 0) - (lefts.get(first) ?? 0) - (widths.get(first) ?? 0);

  return {
    tabId: press.tabId,
    order,
    lefts,
    widths,
    gap,
    grabAt: contentX(list, press.clientX),
    offset: 0,
    target: order.indexOf(press.tabId),
  };
}

function moveDrag(drag: Drag, list: HTMLElement, clientX: number): Drag {
  const left = drag.lefts.get(drag.tabId) ?? 0;
  const width = drag.widths.get(drag.tabId) ?? 0;
  const first = drag.order[0];
  const last = drag.order.at(-1);
  const min = first === undefined ? left : (drag.lefts.get(first) ?? left);
  const max =
    last === undefined
      ? left
      : (drag.lefts.get(last) ?? left) + (drag.widths.get(last) ?? width) - width;
  const placed = Math.min(max, Math.max(min, left + contentX(list, clientX) - drag.grabAt));
  const from = drag.order.indexOf(drag.tabId);
  const centreOf = (id: string): number =>
    (drag.lefts.get(id) ?? 0) + (drag.widths.get(id) ?? 0) / 2;
  // A neighbour gives way once the leading edge of the dragged tab passes its centre.
  const target =
    placed >= left
      ? from +
        drag.order.filter((id, index) => index > from && centreOf(id) < placed + width).length
      : from - drag.order.filter((id, index) => index < from && centreOf(id) > placed).length;

  return { ...drag, offset: placed - left, target };
}

/** How far a tab slides to make room while another passes it. */
function shiftOf(drag: Drag, tabId: string): number {
  if (tabId === drag.tabId) return drag.offset;

  const from = drag.order.indexOf(drag.tabId);
  const index = drag.order.indexOf(tabId);
  const room = (drag.widths.get(drag.tabId) ?? 0) + drag.gap;

  if (index < 0) return 0;

  if (from < drag.target && index > from && index <= drag.target) return -room;

  if (drag.target < from && index >= drag.target && index < from) return room;

  return 0;
}

function droppedOrder(drag: Drag): readonly string[] {
  return drag.order.filter((id) => id !== drag.tabId).toSpliced(drag.target, 0, drag.tabId);
}

function TabItem({
  tab,
  position,
  active,
  onlyTab,
  held,
  shift,
  dragging,
  register,
  onPress,
  dispatch,
}: {
  readonly tab: Tab;
  readonly position: number;
  readonly active: boolean;
  readonly onlyTab: boolean;
  readonly held: HeldKeys;
  readonly shift: number;
  readonly dragging: boolean;
  readonly register: (element: HTMLElement | null) => void;
  readonly onPress: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly dispatch: (action: WindowAction) => void;
}): ReactElement {
  const view = currentView(tab);
  const info = placeInfo(tabPlace(tab));
  const split = view.kind === "panes" && view.panes.length > 1 ? view : undefined;
  const title =
    split === undefined
      ? info.title
      : split.panes.map((pane) => placeInfo(currentPlace(pane)).title).join("  ·  ");
  const digit = position < 9 ? String(position + 1) : undefined;

  const element = (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      aria-label={title}
      {...props(styles.tab, tab.pinned && styles.tabPinned, active && styles.tabActive)}
      onPointerDown={onPress}
      onClick={() => dispatch({ kind: "activate-tab", tabId: tab.id })}
      onMouseDown={(event) => {
        // Middle-click closes; stop the browser's autoscroll from starting first.
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) dispatch({ kind: "close-tab", tabId: tab.id });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ")
          dispatch({ kind: "activate-tab", tabId: tab.id });
      }}
    />
  );

  return (
    <div
      ref={register}
      {...props(styles.slot, tab.pinned && styles.slotPinned, dragging && styles.slotDragging)}
      style={shift === 0 ? undefined : { transform: `translateX(${shift}px)` }}
    >
      <ContextMenu>
        <Tooltip>
          <TooltipTrigger render={<ContextMenuTrigger render={element} />}>
            <span {...props(styles.glyph)}>
              {tab.pinned && info.mark === undefined && info.icon === undefined ? (
                <Icon name="draft" size={13} />
              ) : (
                <PlaceGlyph info={info} />
              )}
            </span>
            {!tab.pinned && <span {...props(styles.label)}>{info.title}</span>}
            {!tab.pinned && split !== undefined && (
              <span {...props(styles.splitMark)} aria-label="Split">
                <Icon name={split.direction === "down" ? "split-down" : "split-right"} size={12} />
              </span>
            )}
            {!tab.pinned && !onlyTab && (
              <span data-slot="tab-close" {...props(styles.close, active && styles.closeVisible)}>
                <Button
                  size="xs"
                  iconOnly
                  icon="close"
                  aria-label="Close tab"
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch({ kind: "close-tab", tabId: tab.id });
                  }}
                />
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent>
            <span {...props(keycapStyles.shortcut)}>
              {title}
              {digit !== undefined && (
                <span {...props(keycapStyles.keys)}>
                  <kbd {...props(keycapStyles.keycap, held.primary && keycapStyles.held)}>⌘</kbd>
                  <kbd {...props(keycapStyles.keycap, held.digit === digit && keycapStyles.held)}>
                    {digit}
                  </kbd>
                </span>
              )}
            </span>
          </TooltipContent>
        </Tooltip>
        <ContextMenuContent aria-label={`${info.title} tab actions`}>
          <ContextMenuItem
            icon={tab.pinned ? "unpin" : "pin"}
            onClick={() => dispatch({ kind: "toggle-pin", tabId: tab.id })}
          >
            {tab.pinned ? "Unpin tab" : "Pin tab"}
          </ContextMenuItem>
          <ContextMenuItem icon="plus" meta="⌘T" onClick={() => dispatch({ kind: "new-tab" })}>
            New tab
          </ContextMenuItem>
          <ContextMenuItem
            icon="copy"
            onClick={() => dispatch({ kind: "duplicate-tab", tabId: tab.id })}
          >
            Duplicate tab
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon="close"
            meta="⌘W"
            onClick={() => dispatch({ kind: "close-tab", tabId: tab.id })}
          >
            Close tab
          </ContextMenuItem>
          <ContextMenuItem
            icon="circle-x"
            onClick={() => dispatch({ kind: "close-others", tabId: tab.id })}
          >
            Close other tabs
          </ContextMenuItem>
          <ContextMenuItem
            icon="arrow-right"
            onClick={() => dispatch({ kind: "close-right", tabId: tab.id })}
          >
            Close tabs to the right
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

export function TabStrip({
  tabs,
  activeTabId,
  dispatch,
}: {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;
  readonly dispatch: (action: WindowAction) => void;
}): ReactElement {
  const held = useHeldKeys();
  const listRef = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const press = useRef<Press | undefined>(undefined);
  const dragRef = useRef<Drag | undefined>(undefined);
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const latest = useRef({ tabs, dispatch });

  useLayoutEffect(() => {
    latest.current = { tabs, dispatch };
  });

  useEffect(() => {
    const settle = (next: Drag | undefined): void => {
      dragRef.current = next;
      setDrag(next);
    };
    const swallowClick = (event: MouseEvent): void => {
      event.stopPropagation();
      event.preventDefault();
    };

    const onMove = (event: PointerEvent): void => {
      const pressed = press.current;
      const list = listRef.current;

      if (pressed === undefined || list === null || event.pointerId !== pressed.pointerId) return;

      let current = dragRef.current;

      if (current === undefined) {
        if (Math.abs(event.clientX - pressed.clientX) < pressed.distance) return;

        const order = latest.current.tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);

        current = startDrag(list, items.current, order, pressed);

        if (current === undefined) return;
        latest.current.dispatch({ kind: "activate-tab", tabId: pressed.tabId });
      }

      const bounds = list.getBoundingClientRect();
      const edge = bounds.width * AUTO_SCROLL_EDGE;

      if (event.clientX < bounds.left + edge) list.scrollLeft -= AUTO_SCROLL_STEP;
      else if (event.clientX > bounds.right - edge) list.scrollLeft += AUTO_SCROLL_STEP;

      settle(moveDrag(current, list, event.clientX));
    };

    const onUp = (event: PointerEvent): void => {
      const current = dragRef.current;

      if (press.current?.pointerId !== event.pointerId) return;
      press.current = undefined;

      if (current === undefined) return;

      // The click that follows a drop must not reach the tab under the pointer.
      window.addEventListener("click", swallowClick, { capture: true, once: true });

      const order = droppedOrder(current);
      const pinned = latest.current.tabs.filter((tab) => tab.pinned).map((tab) => tab.id);

      if (current.target !== current.order.indexOf(current.tabId))
        latest.current.dispatch({ kind: "reorder", tabIds: [...pinned, ...order] });
      settle(undefined);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || dragRef.current === undefined) return;
      event.preventDefault();
      press.current = undefined;
      settle(undefined);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div {...props(styles.strip)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Tabs"
        {...props(styles.list, drag !== undefined && styles.listDragging)}
      >
        {tabs.map((tab, position) => (
          <TabItem
            key={tab.id}
            tab={tab}
            position={position}
            active={tab.id === activeTabId}
            onlyTab={tabs.length === 1}
            held={held}
            shift={drag === undefined || tab.pinned ? 0 : shiftOf(drag, tab.id)}
            dragging={drag?.tabId === tab.id}
            register={(element) => {
              if (element === null) items.current.delete(tab.id);
              else items.current.set(tab.id, element);
            }}
            onPress={(event) => {
              if (
                tab.pinned ||
                event.button !== 0 ||
                (event.target instanceof Element &&
                  event.target.closest('[data-slot="tab-close"]') !== null)
              )
                return;

              press.current = {
                tabId: tab.id,
                pointerId: event.pointerId,
                clientX: event.clientX,
                distance:
                  event.pointerType === "touch"
                    ? ACTIVATION_DISTANCE.touch
                    : ACTIVATION_DISTANCE.mouse,
              };
            }}
            dispatch={dispatch}
          />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              iconOnly
              icon="plus"
              aria-label="New tab"
              onClick={() => dispatch({ kind: "new-tab" })}
            />
          }
        />
        <TooltipContent>New tab ⌘T</TooltipContent>
      </Tooltip>
      <span {...props(styles.fill)} />
    </div>
  );
}
