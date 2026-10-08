/**
 * The project's tabs in the titlebar, where the desktop's window tabs live.
 * The desktop's strip is reused as is: its styles, its Tabs primitives, and
 * its drag-to-reorder. On top of it sit the switches this lab compares:
 *
 * - Pill is the shipped tab: a 28px pill that wears the main card when active.
 * - Connected is define.app's: the active tab reaches the card and curves into
 *   it, and the card squares the corner where the tab sits flush.
 * - Fit shrinks tabs to 72px before the list scrolls, as the desktop does;
 *   Fixed holds 152 to 180px and scrolls sooner, as define does.
 * - Past the edge, the list scrolls under a fade with the active tab pinned
 *   to the edge it meets, or the extra tabs fold into a menu.
 */
import { create, props } from "@stylexjs/stylex";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { SortableItem, SortableList } from "@nyte-ai/app/components/sortable-strip.tsx";
import { stripStyles } from "@nyte-ai/app/tabs/window-tab-strip.stylex.ts";
import { shell } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@nyte-ai/ui/context-menu";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { button, radius } from "@nyte-ai/ui/schema.stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { motion, role, type } from "@nyte-ai/ui/vars.stylex";

export interface TabItem {
  readonly id: string;
  readonly title: string;
  readonly glyph: ReactNode;
  readonly closable: boolean;
  /** A line under the title in the tooltip, so a crowded strip can be read without switching. */
  readonly preview?: string;
}

export type TabStyle = "pill" | "connected";

export type TabWidth = "fit" | "fixed";

export type TabOverflow = "scroll" | "menu";

export interface TabDesign {
  readonly style: TabStyle;
  readonly width: TabWidth;
  readonly overflow: TabOverflow;
  readonly separators: boolean;
}

/** Mirrors `--nyte-shape-card`; a path cannot read a custom property. */
const CORNER = 12;

const TAB_MIN = 152;

const TAB_MAX = 180;

/** How close to an edge the active tab may come before it pins there. */
const EDGE = 20;

const FADE = 28;

/** The corner between the tab's wall and the card, filled and then traced along the arc. */
const CURVE_LEFT = `M${CORNER} 0V${CORNER}H0A${CORNER} ${CORNER} 0 0 0 ${CORNER} 0Z`;

const ARC_LEFT = `M0 ${CORNER}A${CORNER} ${CORNER} 0 0 0 ${CORNER} 0`;

const CURVE_RIGHT = `M0 0V${CORNER}H${CORNER}A${CORNER} ${CORNER} 0 0 1 0 0Z`;

const ARC_RIGHT = `M${CORNER} ${CORNER}A${CORNER} ${CORNER} 0 0 1 0 0`;

export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
  axis: "x" | "y" = "x",
): {
  readonly fromStart: boolean;
  readonly fromEnd: boolean;
} {
  const [edges, setEdges] = useState({ fromStart: false, fromEnd: false });

  useEffect(() => {
    const node = ref.current;

    if (node === null) return;

    const read = (): void => {
      // Absolute, so a column-reverse scroller reports its edges too, mirrored.
      const offset = Math.abs(axis === "x" ? node.scrollLeft : node.scrollTop);
      const extent = axis === "x" ? node.scrollWidth : node.scrollHeight;
      const frame = axis === "x" ? node.clientWidth : node.clientHeight;
      const fromStart = offset > 1;
      const fromEnd = offset < extent - frame - 1;

      setEdges((current) =>
        current.fromStart === fromStart && current.fromEnd === fromEnd
          ? current
          : { fromStart, fromEnd },
      );
    };

    read();
    node.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);

    observer.observe(node);

    for (const child of node.children) observer.observe(child);

    return () => {
      node.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [ref, axis]);

  return edges;
}

/** Whether the active tab is touching the list's left or right edge. */
function useStuck(
  ref: RefObject<HTMLElement | null>,
  activeId: string,
  count: number,
): { readonly left: boolean; readonly right: boolean } {
  const [stuck, setStuck] = useState({ left: false, right: false });

  useEffect(() => {
    const node = ref.current;

    if (node === null) return;

    const read = (): void => {
      const active = node.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`);

      if (!(active instanceof HTMLElement)) {
        setStuck({ left: false, right: false });

        return;
      }

      const frame = node.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      const overflowing = node.scrollWidth > node.clientWidth + 1;
      const left = overflowing && box.left <= frame.left + EDGE;
      const right = overflowing && box.right >= frame.right - EDGE;

      setStuck((current) =>
        current.left === left && current.right === right ? current : { left, right },
      );
    };

    read();
    node.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);

    observer.observe(node);

    return () => {
      node.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [ref, activeId, count]);

  return stuck;
}

/** A new tab scrolls to the centre; a newly active one scrolls just far enough to clear the edge. */
function useReveal(
  ref: RefObject<HTMLElement | null>,
  ids: readonly string[],
  activeId: string,
): void {
  const seen = useRef<readonly string[]>(ids);

  useEffect(() => {
    const node = ref.current;
    const added = ids.find((id) => !seen.current.includes(id));

    seen.current = ids;

    if (node === null || added === undefined) return;

    const target = node.querySelector(`[data-tab-id="${CSS.escape(added)}"]`);

    target?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [ref, ids]);

  useEffect(() => {
    const node = ref.current;

    if (node === null) return;

    const target = node.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`);

    if (!(target instanceof HTMLElement)) return;

    const frame = node.getBoundingClientRect();
    const box = target.getBoundingClientRect();

    if (box.left >= frame.left + EDGE && box.right <= frame.right - EDGE) return;

    const left =
      box.right > frame.right - EDGE
        ? target.offsetLeft - node.clientWidth + target.offsetWidth + EDGE
        : target.offsetLeft - EDGE;

    node.scrollTo({ left, behavior: "smooth" });
  }, [ref, activeId]);
}

/** How many fixed-width tabs fit in the list, for the menu switch. */
function useCapacity(ref: RefObject<HTMLElement | null>): number {
  const [capacity, setCapacity] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const node = ref.current;

    if (node === null) return;

    const read = (): void => setCapacity(Math.max(1, Math.floor(node.clientWidth / (TAB_MIN + 2))));

    read();
    const observer = new ResizeObserver(read);

    observer.observe(node);

    return () => observer.disconnect();
  }, [ref]);

  return capacity;
}

function Curve({ side }: { readonly side: "left" | "right" }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width={CORNER}
      height={CORNER}
      {...props(styles.curve, side === "left" ? styles.curveLeft : styles.curveRight)}
    >
      <path d={side === "left" ? CURVE_LEFT : CURVE_RIGHT} fill="currentColor" />
      <path d={side === "left" ? ARC_LEFT : ARC_RIGHT} {...props(styles.arc)} />
    </svg>
  );
}

function TabView({
  tab,
  position,
  active,
  first,
  connected,
  mac,
  closable,
  othersClosable,
  rightClosable,
  onClose,
  onCloseOthers,
  onCloseRight,
  onHover,
}: {
  readonly tab: TabItem;
  readonly position: number;
  readonly active: boolean;
  readonly first: boolean;
  readonly connected: boolean;
  readonly mac: boolean;
  readonly closable: boolean;
  readonly othersClosable: boolean;
  readonly rightClosable: boolean;
  readonly onClose: () => void;
  readonly onCloseOthers: () => void;
  readonly onCloseRight: () => void;
  readonly onHover: (id: string | undefined) => void;
}): ReactElement {
  const digit = position < 9 ? String(position + 1) : undefined;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="presentation"
            data-tab-id={tab.id}
            {...props(
              stripStyles.tab,
              closable && stripStyles.tabClosable,
              active && stripStyles.tabActive,
              connected && styles.connected,
              connected && active && styles.connectedActive,
            )}
            onPointerEnter={() => onHover(tab.id)}
            onPointerLeave={() => onHover(undefined)}
            onMouseDown={(event) => {
              // Middle-click closes; stop the browser's autoscroll from starting first.
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button === 1 && closable) onClose();
            }}
          />
        }
      >
        {connected && active && !first && <Curve side="left" />}
        <Tooltip>
          <TooltipTrigger
            render={
              <Tabs.Tab
                value={tab.id}
                aria-label={tab.title}
                xstyle={[
                  stripStyles.tabButton,
                  !closable && stripStyles.tabButtonUnclosable,
                  connected && styles.connectedButton,
                  connected && !active && styles.connectedButtonIdle,
                ]}
              />
            }
          >
            <span {...props(stripStyles.glyph)}>{tab.glyph}</span>
            <span {...props(stripStyles.label)}>{tab.title}</span>
          </TooltipTrigger>
          <TooltipContent>
            <span {...props(styles.tip)}>
              <span {...props(stripStyles.shortcut)}>
                {tab.title}
                {digit !== undefined && (
                  <span {...props(stripStyles.keys)}>
                    <Kbd keys={[mac ? "⌘" : "Ctrl"]} />
                    <Kbd keys={[digit]} />
                  </span>
                )}
              </span>
              {tab.preview !== undefined && (
                <span {...props(styles.tipPreview)}>{tab.preview}</span>
              )}
            </span>
          </TooltipContent>
        </Tooltip>
        {closable && (
          <span {...props(stripStyles.close, active && stripStyles.closeVisible)}>
            <Button
              size="xs"
              iconOnly
              icon="close"
              aria-label={`Close ${tab.title}`}
              tabIndex={-1}
              onClick={onClose}
            />
          </span>
        )}
        {connected && active && <Curve side="right" />}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${tab.title} tab actions`}>
        <ContextMenuItem icon="close" meta="⌥W" disabled={!closable} onClick={onClose}>
          Close Tab
        </ContextMenuItem>
        <ContextMenuItem icon="circle-x" disabled={!othersClosable} onClick={onCloseOthers}>
          Close Other Tabs
        </ContextMenuItem>
        <ContextMenuItem icon="arrow-right" disabled={!rightClosable} onClick={onCloseRight}>
          Close Tabs to the Right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon="unarchive" meta="⌘⇧T">
          Reopen Closed Tab
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TabStrip({
  tabs,
  activeId,
  design,
  mac,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
  onReorder,
  onAdd,
  onCornerChange,
}: {
  readonly tabs: readonly TabItem[];
  readonly activeId: string;
  readonly design: TabDesign;
  readonly mac: boolean;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onCloseOthers: (id: string) => void;
  readonly onCloseRight: (id: string) => void;
  readonly onReorder: (ids: readonly string[]) => void;
  readonly onAdd: (() => void) | undefined;
  /** The card squares its top-left corner while the active tab sits flush against it. */
  readonly onCornerChange: (square: boolean) => void;
}): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const capacity = useCapacity(listRef);
  const connected = design.style === "connected";
  const menuMode = design.overflow === "menu" && design.width === "fixed";
  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);

  const shown = (() => {
    if (!menuMode || tabs.length <= capacity) return tabs;
    const head = tabs.slice(0, capacity);
    const active = tabs[activeIndex];

    // The active tab always stays in view: it takes the last visible slot.
    return activeIndex >= capacity && active !== undefined ? [...head.slice(0, -1), active] : head;
  })();

  const hidden = tabs.filter((tab) => !shown.includes(tab));
  const ids = shown.map((tab) => tab.id);
  const edges = useScrollEdges(listRef);
  const stuck = useStuck(listRef, activeId, shown.length);

  useReveal(listRef, ids, activeId);

  const square = connected && (activeIndex === 0 || stuck.left);

  useEffect(() => {
    onCornerChange(square);
  }, [square, onCornerChange]);

  // The fade on an edge gives way when the active tab is pinned there.
  const fadeLeft = edges.fromStart && !stuck.left ? FADE : 0;
  const fadeRight = edges.fromEnd && !stuck.right ? FADE : 0;

  return (
    <Tabs.Root
      value={activeId}
      xstyle={[stripStyles.strip, styles.strip]}
      onValueChange={onActivate}
    >
      <Tabs.List
        ref={listRef}
        aria-label="Open in this project"
        xstyle={[
          stripStyles.list,
          connected && styles.listConnected,
          styles.fade(fadeLeft, fadeRight),
        ]}
      >
        <SortableList ids={ids} listRef={listRef} onPick={onActivate} onReorder={onReorder}>
          {shown.map((tab, position) => {
            const active = tab.id === activeId;
            const next = shown[position + 1];

            const separator =
              design.separators &&
              connected &&
              next !== undefined &&
              !active &&
              next.id !== activeId &&
              tab.id !== hovered &&
              next.id !== hovered;

            return (
              <SortableItem
                key={tab.id}
                id={tab.id}
                xstyle={[
                  stripStyles.slot,
                  design.width === "fixed" && styles.slotFixed,
                  connected && styles.slotConnected,
                  active && styles.slotActive,
                  active && stuck.left && styles.slotStuckLeft,
                  active && stuck.right && styles.slotStuckRight,
                  active && stuck.right && connected && styles.slotStuckRightConnected,
                ]}
              >
                <TabView
                  tab={tab}
                  position={position}
                  active={active}
                  first={position === 0}
                  connected={connected}
                  mac={mac}
                  closable={tab.closable}
                  othersClosable={tabs.some((other) => other.id !== tab.id && other.closable)}
                  rightClosable={tabs.slice(tabs.indexOf(tab) + 1).some((other) => other.closable)}
                  onClose={() => onClose(tab.id)}
                  onCloseOthers={() => onCloseOthers(tab.id)}
                  onCloseRight={() => onCloseRight(tab.id)}
                  onHover={setHovered}
                />
                {connected && design.separators && (
                  <span
                    aria-hidden="true"
                    {...props(styles.separator, !separator && styles.separatorHidden)}
                  />
                )}
              </SortableItem>
            );
          })}
        </SortableList>
      </Tabs.List>
      {hidden.length > 0 && (
        <Menu>
          <MenuTrigger
            render={
              <Button size="sm" xstyle={styles.more}>
                +{hidden.length}
              </Button>
            }
          />
          <MenuContent aria-label="More tabs" align="end">
            {hidden.map((tab) => (
              <MenuItem key={tab.id} leading={tab.glyph} onClick={() => onActivate(tab.id)}>
                {tab.title}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
      <span {...props(stripStyles.control)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                iconOnly
                icon="plus"
                aria-label="Open the next agent"
                disabled={onAdd === undefined}
                title={undefined}
                onClick={onAdd}
              />
            }
          />
          <TooltipContent>Open the next agent</TooltipContent>
        </Tooltip>
      </span>
    </Tabs.Root>
  );
}

const styles = create({
  strip: { WebkitAppRegion: "no-drag" },
  fade: (left: number, right: number) => ({
    maskImage: `linear-gradient(to right, transparent 0, black ${String(left)}px, black calc(100% - ${String(right)}px), transparent 100%)`,
  }),
  /** Connected tabs stand on the titlebar's floor, where the card begins; the end keeps room for the last curve. */
  listConnected: { alignItems: "flex-end", gap: 0, paddingInlineEnd: CORNER },
  slotFixed: { flex: `0 1 ${String(TAB_MAX)}px`, minWidth: TAB_MIN },
  slotConnected: {
    position: "relative",
    alignItems: "flex-end",
    height: `calc(${shell.titlebarHeight} - 4px)`,
  },
  slotActive: { zIndex: 2 },
  slotStuckLeft: { position: "sticky", left: 0 },
  slotStuckRight: { position: "sticky", right: 0 },
  slotStuckRightConnected: { right: CORNER },
  connected: {
    height: "100%",
    paddingBlockEnd: 3,
    borderRadius: 0,
    borderStartStartRadius: radius.card,
    borderStartEndRadius: radius.card,
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
  /** The active tab's hairline runs up its sides and over the top; the card's own closes the loop. */
  connectedActive: {
    backgroundColor: { default: role.bgBase, ":hover": role.bgBase },
    boxShadow: `inset 1px 0 0 ${role.borderSecondaryTranslucent}, inset -1px 0 0 ${role.borderSecondaryTranslucent}, inset 0 1px 0 ${role.borderSecondaryTranslucent}`,
  },
  connectedButton: { height: button.heightMd, borderRadius: button.radiusMd },
  connectedButtonIdle: {
    marginInline: 2,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    transitionProperty: "background-color",
    transitionDuration: motion.durationNormal,
    transitionTimingFunction: motion.easeOut,
  },
  curve: {
    position: "absolute",
    bottom: 0,
    color: role.bgBase,
    pointerEvents: "none",
  },
  curveLeft: { left: -CORNER },
  curveRight: { right: -CORNER },
  arc: { fill: "none", stroke: role.borderSecondaryTranslucent, strokeWidth: 1 },
  separator: {
    position: "absolute",
    right: -1,
    bottom: 11,
    width: 1,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: role.borderStrong,
    transitionProperty: "opacity",
    transitionDuration: motion.durationNormal,
  },
  separatorHidden: { opacity: 0 },
  more: { flexShrink: 0, WebkitAppRegion: "no-drag" },
  tip: { display: "flex", flexDirection: "column", gap: 2, maxWidth: 260, whiteSpace: "normal" },
  tipPreview: { color: role.contentSecondary, fontSize: type.fontXs },
});
