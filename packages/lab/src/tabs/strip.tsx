import { create, props } from "@stylexjs/stylex";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { button, glyph, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { motion as motionTokens, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { shell } from "@nyte-ai/app/theme/schema.stylex.ts";
import type { ShellTab } from "./fixtures";

export interface StripDesign {
  /** The radius of the inverse curves where the active tab flares into the card. */
  readonly inverse: "card" | "control";
}

/** Which sides of the active tab sit flush with the card's edge. */
export interface CardCorners {
  readonly left: boolean;
  readonly right: boolean;
}

const COLLAPSED = "@container (max-width: 72px)";

const GAP = 4;

/** Inactive tabs stop this far above the card; the active one runs 1px into it. */
const LIFT = GAP + 1;

/** Measured before paint, so the card's corners and the tab's outline change in one frame. */
export function useCardCorners(
  stripRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  activeId: string,
): CardCorners {
  const [corners, setCorners] = useState<CardCorners>({ left: false, right: false });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the active tab against the card before paint
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const card = cardRef.current;

    if (strip === null || card === null) return;

    const read = (): void => {
      const active = strip.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`);

      if (!(active instanceof HTMLElement)) {
        setCorners((current) =>
          current.left || current.right ? { left: false, right: false } : current,
        );

        return;
      }

      const tab = active.getBoundingClientRect();
      const frame = card.getBoundingClientRect();
      const left = Math.abs(tab.left - frame.left) < 1;
      const right = Math.abs(tab.right - frame.right) < 1;

      setCorners((current) =>
        current.left === left && current.right === right ? current : { left, right },
      );
    };

    read();
    const observer = new ResizeObserver(read);
    const active = strip.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`);

    observer.observe(strip);
    observer.observe(card);

    if (active instanceof HTMLElement) observer.observe(active);

    strip.addEventListener("scroll", read, { passive: true });

    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", read);
    };
  }, [stripRef, cardRef, activeId]);

  return corners;
}

interface Geometry {
  readonly width: number;
  readonly height: number;
  /** The tab's top corners: the card's own radius, so a flush tab reads as the card's corner. */
  readonly corner: number;
  readonly inverse: number;
}

/**
 * The active tab and its inverse curves as one shape, so every arc is a true circle and nothing
 * seams. The tab box runs 1px into the card to cover the card's top hairline; the inverse curves
 * are tangent to the card's real top edge, 1px above the box's bottom. The outline is inset half
 * a pixel, as the card's inset hairline is, so it meets the card's hairline at each curve's end.
 */
function sheetPaths(geometry: Geometry, flush: CardCorners) {
  const corner = geometry.corner;
  const inverse = geometry.inverse;
  const bottom = geometry.height;
  const edge = bottom - 1;
  const left = flush.left ? 0 : inverse;
  const right = left + geometry.width;
  const end = right + (flush.right ? 0 : inverse);
  const half = 0.5;

  const fill = [
    flush.left
      ? `M${left} ${bottom}`
      : `M0 ${bottom}V${edge}A${inverse} ${inverse} 0 0 0 ${left} ${edge - inverse}`,
    `V${corner}A${corner} ${corner} 0 0 1 ${left + corner} 0`,
    `H${right - corner}A${corner} ${corner} 0 0 1 ${right} ${corner}`,
    flush.right
      ? `V${bottom}`
      : `V${edge - inverse}A${inverse} ${inverse} 0 0 0 ${end} ${edge}V${bottom}`,
    "Z",
  ].join("");

  const outer = inverse + half;
  const inner = corner - half;

  const outline = [
    flush.left
      ? `M${left + half} ${bottom}`
      : `M0 ${edge + half}A${outer} ${outer} 0 0 0 ${left + half} ${edge - inverse}`,
    `V${corner}A${inner} ${inner} 0 0 1 ${left + corner} ${half}`,
    `H${right - corner}A${inner} ${inner} 0 0 1 ${right - half} ${corner}`,
    flush.right ? `V${bottom}` : `V${edge - inverse}A${outer} ${outer} 0 0 0 ${end} ${edge + half}`,
  ].join("");

  return { fill, edge: outline };
}

function TabSheet({
  flush,
  design,
}: {
  readonly flush: CardCorners;
  readonly design: StripDesign;
}): ReactElement {
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [geometry, setGeometry] = useState<Geometry | undefined>(undefined);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the probe before paint, again per design
  useLayoutEffect(() => {
    const probe = probeRef.current;

    if (probe === null) return;

    const read = (): void => {
      const style = getComputedStyle(probe);

      setGeometry({
        width: probe.offsetWidth,
        height: probe.offsetHeight,
        corner: parseFloat(style.borderTopLeftRadius),
        inverse: parseFloat(style.borderTopRightRadius),
      });
    };

    read();
    const observer = new ResizeObserver(read);

    observer.observe(probe);

    return () => observer.disconnect();
  }, [design.inverse]);

  const paths = geometry === undefined ? undefined : sheetPaths(geometry, flush);
  const offset = flush.left || geometry === undefined ? 0 : geometry.inverse;

  return (
    <span
      ref={probeRef}
      aria-hidden="true"
      {...props(
        styles.probe,
        design.inverse === "card" ? styles.inverseCard : styles.inverseControl,
      )}
    >
      {geometry !== undefined && paths !== undefined && (
        <svg
          width={geometry.width + offset + (flush.right ? 0 : geometry.inverse)}
          height={geometry.height}
          {...props(styles.sheet, placed.outline(-offset))}
        >
          <path d={paths.fill} {...props(styles.sheetFill)} />
          <path d={paths.edge} {...props(styles.sheetEdge)} />
        </svg>
      )}
    </span>
  );
}

/** A running or unread chat shows its status dot where its icon would be. */
function Glyph({ tab }: { readonly tab: ShellTab }): ReactElement {
  if (tab.mark !== "idle" || tab.unread) return <StatusDot mark={tab.mark} unread={tab.unread} />;

  return <Icon name={tab.icon} size={14} />;
}

function Tab({
  tab,
  position,
  active,
  flush,
  design,
  onActivate,
  onClose,
}: {
  readonly tab: ShellTab;
  readonly position: number;
  readonly active: boolean;
  readonly flush: CardCorners;
  readonly design: StripDesign;
  readonly onActivate: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const pinned = tab.kind === "pinned";
  const digit = position >= 0 && position < 9 ? String(position + 1) : undefined;

  const body = (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={tab.title}
      data-tab-id={tab.id}
      {...props(
        styles.tab,
        pinned ? styles.tabPinned : styles.tabShrink,
        active ? styles.active : styles.inactive,
      )}
      onMouseDown={(event) => {
        if (event.button === 0) onActivate();

        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && !pinned) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {active && <TabSheet flush={flush} design={design} />}
      <span {...props(styles.glyph)}>
        <Glyph tab={tab} />
      </span>
      {!pinned && <span {...props(styles.label)}>{tab.title}</span>}
      {tab.split !== undefined && !pinned && (
        <span {...props(styles.trailingMark, styles.collapsible)}>
          <Icon name={tab.split === "down" ? "split-down" : "split-right"} size={12} />
        </span>
      )}
      {!pinned && (
        <span {...props(styles.close, styles.collapsible, !active && styles.closeOnHover)}>
          <Button
            size="2xs"
            variant="ghost"
            iconOnly
            icon="x"
            aria-label={`Close ${tab.title}`}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClose}
          />
        </span>
      )}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={body} />
      <TooltipContent side="bottom" sideOffset={8}>
        <span {...props(styles.tip)}>
          {tab.title}
          {digit !== undefined && <Kbd keys={["⌥", digit]} plain />}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function WindowTabStrip({
  tabs,
  activeId,
  numbered,
  flush,
  design,
  stripRef,
  onActivate,
  onClose,
  onNew,
}: {
  readonly tabs: readonly ShellTab[];
  readonly activeId: string;
  /** Tab ids in ⌥1–9 order. */
  readonly numbered: readonly string[];
  readonly flush: CardCorners;
  readonly design: StripDesign;
  readonly stripRef: RefObject<HTMLDivElement | null>;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onNew: () => void;
}): ReactElement {
  const groups = [
    tabs.filter((tab) => tab.kind === "pinned"),
    tabs.filter((tab) => tab.kind !== "pinned"),
  ].filter((group) => group.length > 0);

  return (
    <div ref={stripRef} role="tablist" aria-label="Tabs" {...props(styles.strip)}>
      {groups.map((group, index) => (
        <div key={group[0]?.kind === "pinned" ? "pinned" : "tabs"} {...props(styles.group)}>
          {index > 0 && <span aria-hidden="true" {...props(styles.divider)} />}
          <AnimatePresence initial={false} mode="popLayout">
            {group.map((tab) => {
              const active = tab.id === activeId;

              return (
                <motion.div
                  key={tab.id}
                  layout="position"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.16 }}
                  {...props(
                    styles.slot,
                    tab.kind !== "pinned" && styles.slotShrink,
                    active && styles.slotActive,
                  )}
                >
                  <Tab
                    tab={tab}
                    position={numbered.indexOf(tab.id)}
                    active={active}
                    flush={flush}
                    design={design}
                    onActivate={() => onActivate(tab.id)}
                    onClose={() => onClose(tab.id)}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ))}
      <span {...props(styles.add)}>
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          icon="plus"
          aria-label="New tab"
          onClick={onNew}
        />
      </span>
    </div>
  );
}

const styles = create({
  strip: {
    display: "flex",
    alignItems: "stretch",
    gap: 2,
    flex: 1,
    minWidth: 0,
    height: "calc(100% + 1px)",
    marginBottom: -1,
    // Room for the first tab's inverse curve inside the scroll box, which clips overflow.
    marginInlineStart: `calc(-1 * max(${shell.cardRadius}, ${radius.control}))`,
    paddingInlineStart: `max(${shell.cardRadius}, ${radius.control})`,
    paddingTop: GAP,
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
  },
  group: { display: "contents" },
  slot: {
    position: "relative",
    display: "flex",
    alignItems: "inherit",
    flexShrink: 0,
    minWidth: 0,
  },
  slotShrink: { flexShrink: 1, flexBasis: 176, minWidth: button.heightMd },
  slotActive: { zIndex: 1 },
  tab: {
    position: "relative",
    isolation: "isolate",
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    paddingInline: 8,
    borderRadius: button.radiusMd,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    cursor: "default",
    userSelect: "none",
    outline: "none",
    "--_reveal": { default: "0", ":hover": "1", ":focus-within": "1" },
    transitionProperty: "background-color, color",
    transitionDuration: motionTokens.durationNormal,
    transitionTimingFunction: motionTokens.easeOut,
  },
  tabShrink: {
    containerType: "inline-size",
    justifyContent: { default: "flex-start", [COLLAPSED]: "center" },
    paddingInline: { default: 8, [COLLAPSED]: 0 },
  },
  tabPinned: { flexShrink: 0, width: button.heightMd, paddingInline: 0, justifyContent: "center" },
  /** Same content box as `active`, which trades this margin for padding, so a click moves nothing. */
  inactive: {
    marginBottom: LIFT,
    color: role.contentSecondary,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
  },
  active: {
    paddingBottom: LIFT,
    color: role.contentPrimary,
  },
  probe: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    pointerEvents: "none",
    borderTopLeftRadius: shell.cardRadius,
  },
  inverseCard: { borderTopRightRadius: shell.cardRadius },
  inverseControl: { borderTopRightRadius: radius.control },
  sheet: { position: "absolute", top: 0, overflow: "visible" },
  sheetFill: { fill: role.bgBase },
  sheetEdge: {
    fill: "none",
    stroke: role.borderSecondaryTranslucent,
    strokeWidth: 1,
  },
  glyph: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.box,
    height: glyph.box,
  },
  label: {
    display: { default: "block", [COLLAPSED]: "none" },
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  collapsible: {
    display: { default: "inline-flex", [COLLAPSED]: "none" },
  },
  trailingMark: { alignItems: "center", flexShrink: 0, color: role.contentTertiary },
  close: { alignItems: "center", flexShrink: 0, marginInlineEnd: -4 },
  closeOnHover: {
    opacity: "var(--_reveal)",
    transitionProperty: "opacity",
    transitionDuration: motionTokens.durationNormal,
  },
  add: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    marginInlineStart: 2,
    marginBottom: LIFT,
  },
  divider: {
    flexShrink: 0,
    alignSelf: "center",
    width: 1,
    height: glyph.sm,
    marginInline: 4,
    marginBottom: LIFT,
    borderRadius: radius.pill,
    backgroundColor: role.borderStrongTranslucent,
  },
  tip: { display: "inline-flex", alignItems: "center", gap: 8 },
});

const placed = create({
  outline: (left: number) => ({ left }),
});
