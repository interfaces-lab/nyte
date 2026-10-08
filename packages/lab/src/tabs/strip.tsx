/**
 * A window tab strip after Dia and Arc. Pinned places sit first as bare icons,
 * folders next, then the chats opened this session; a hairline divides the
 * groups. The active tab can wear the card below it and curve into it, the
 * close button can stand beside the active tab instead of hiding inside every
 * tab, and crowded tabs collapse to their icon before anything scrolls.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactElement, type RefObject } from "react";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { button, glyph, radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { motion as motionTokens, role, type } from "@nyte-ai/ui/vars.stylex";
import type { ShellTab, TabKind } from "./fixtures";

export type ActiveStyle = "connected" | "card" | "flat";

export type InactiveStyle = "chip" | "ghost";

export type ClosePlacement = "hover" | "beside" | "active";

export type PinnedStyle = "icon" | "label" | "off";

export type WidthRule = "shrink" | "fixed";

export type StatusPlacement = "glyph" | "badge" | "dot";

export interface StripDesign {
  readonly active: ActiveStyle;
  readonly inactive: InactiveStyle;
  readonly close: ClosePlacement;
  readonly pinned: PinnedStyle;
  readonly folders: boolean;
  readonly dividers: boolean;
  readonly width: WidthRule;
  readonly status: StatusPlacement;
}

/** Which top corners of the card square off because the active tab sits flush there. */
export interface CardCorners {
  readonly left: boolean;
  readonly right: boolean;
}

/** Mirrors `--nyte-shape-card`; a path cannot read a custom property. */
const CORNER = 12;

/** Below this a chat tab shows only its icon, as Dia does when the strip fills. */
const COLLAPSED = "@container (max-width: 72px)";

/** Air between a tab and the bar's edges; the card sits this far below a floating tab too. */
const GAP = 4;

const CURVE_LEFT = `M${CORNER} 0V${CORNER}H0A${CORNER} ${CORNER} 0 0 0 ${CORNER} 0Z`;

const CURVE_RIGHT = `M0 0V${CORNER}H${CORNER}A${CORNER} ${CORNER} 0 0 1 0 0Z`;

/** The card squares a corner when the active tab's wall lines up with its edge. */
export function useCardCorners(
  stripRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  activeId: string,
  connected: boolean,
): CardCorners {
  const [corners, setCorners] = useState<CardCorners>({ left: false, right: false });

  useEffect(() => {
    const strip = stripRef.current;
    const card = cardRef.current;

    if (strip === null || card === null) return;

    const read = (): void => {
      const active = strip.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`);

      if (!connected || !(active instanceof HTMLElement)) {
        setCorners((current) =>
          current.left || current.right ? { left: false, right: false } : current,
        );

        return;
      }

      const tab = active.getBoundingClientRect();
      const frame = card.getBoundingClientRect();
      const left = Math.abs(tab.left - frame.left) < 2;
      const right = Math.abs(tab.right - frame.right) < 2;

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
  }, [stripRef, cardRef, activeId, connected]);

  return corners;
}

function markTone(tab: ShellTab) {
  switch (tab.mark) {
    case "working":
      return intent.primary;
    case "waiting":
    case "retry":
      return intent.warning;
    case "failed":
      return intent.danger;
    case "idle":
      return tab.unread ? intent.primary : undefined;
    default: {
      const _exhaustive: never = tab.mark;

      return _exhaustive;
    }
  }
}

/** The place's icon, or its status standing in for it, or both with the status pinned to a corner. */
function Glyph({
  tab,
  placement,
}: {
  readonly tab: ShellTab;
  readonly placement: StatusPlacement;
}): ReactElement {
  const icon = <Icon name={tab.icon} size={14} />;

  if (placement === "glyph" && (tab.mark !== "idle" || tab.unread))
    return <StatusDot mark={tab.mark} unread={tab.unread} />;

  const tone = markTone(tab);

  if (placement !== "badge" || tone === undefined) return icon;

  return (
    <span {...props(styles.badgeHost)}>
      {icon}
      <span {...props(styles.badgeRing)}>
        <span {...props(tone, styles.badge, tab.mark === "working" && styles.badgePulse)} />
      </span>
    </span>
  );
}

function shortcutFor(position: number): string | undefined {
  return position < 9 ? String(position + 1) : undefined;
}

function Tab({
  tab,
  position,
  active,
  design,
  onActivate,
  onClose,
}: {
  readonly tab: ShellTab;
  readonly position: number;
  readonly active: boolean;
  readonly design: StripDesign;
  readonly onActivate: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const connected = design.active === "connected";
  const iconOnly = tab.kind === "pinned" && design.pinned === "icon";
  const closable = tab.kind === "chat";

  const closeInside =
    closable && (design.close === "hover" || (design.close === "active" && active));

  const digit = shortcutFor(position);

  const body = (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={tab.title}
      data-tab-id={tab.id}
      {...props(
        styles.tab,
        tab.kind === "chat" && (design.width === "shrink" ? styles.tabShrink : styles.tabFixed),
        tab.kind === "chat" && active && design.width === "shrink" && styles.tabShrinkActive,
        tab.kind === "folder" && styles.tabFolder,
        tab.kind === "pinned" && styles.tabPinned,
        iconOnly && styles.tabIconOnly,
        !active && design.inactive === "chip" && styles.chip,
        !active && design.inactive === "ghost" && styles.ghost,
        !active && connected && styles.lift,
        active && connected && styles.activeConnected,
        active && design.active === "card" && styles.activeCard,
        active && design.active === "flat" && styles.activeFlat,
      )}
      onMouseDown={(event) => {
        if (event.button === 0) onActivate();

        // Middle-click closes; stop the browser's autoscroll from starting first.
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && closable) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {active && connected && (
        <svg aria-hidden="true" {...props(styles.curve, styles.curveLeft)}>
          <path d={CURVE_LEFT} fill="currentColor" />
        </svg>
      )}
      <span {...props(styles.glyph)}>
        <Glyph tab={tab} placement={design.status} />
      </span>
      {!iconOnly && (
        <span {...props(styles.label, tab.kind === "chat" && styles.labelCollapsible)}>
          {tab.title}
        </span>
      )}
      {tab.kind === "folder" && tab.count !== undefined && tab.count > 0 && (
        <span {...props(styles.count)}>{tab.count}</span>
      )}
      {tab.split !== undefined && !iconOnly && (
        <span {...props(styles.trailingMark, styles.collapsible)}>
          <Icon name={tab.split === "down" ? "split-down" : "split-right"} size={12} />
        </span>
      )}
      {design.status === "dot" && !iconOnly && (tab.mark !== "idle" || tab.unread) && (
        <span {...props(styles.trailingMark, styles.collapsible)}>
          <StatusDot mark={tab.mark} unread={tab.unread} />
        </span>
      )}
      {closeInside && (
        <span
          {...props(
            styles.close,
            styles.collapsible,
            design.close === "hover" && !active && styles.closeOnHover,
          )}
        >
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
      {active && connected && (
        <svg aria-hidden="true" {...props(styles.curve, styles.curveRight)}>
          <path d={CURVE_RIGHT} fill="currentColor" />
        </svg>
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

function Divider({ lifted }: { readonly lifted: boolean }): ReactElement {
  return <span aria-hidden="true" {...props(styles.divider, lifted && styles.lift)} />;
}

const GROUPS: readonly TabKind[] = ["pinned", "folder", "chat"];

export function WindowTabStrip({
  tabs,
  activeId,
  design,
  stripRef,
  onActivate,
  onClose,
  onNew,
}: {
  readonly tabs: readonly ShellTab[];
  readonly activeId: string;
  readonly design: StripDesign;
  readonly stripRef: RefObject<HTMLDivElement | null>;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onNew: () => void;
}): ReactElement {
  const connected = design.active === "connected";

  const groups = GROUPS.flatMap((kind) => {
    const group = tabs.filter((tab) => tab.kind === kind);

    return group.length === 0 ? [] : [group];
  });

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Tabs"
      {...props(styles.strip, connected && styles.stripConnected)}
    >
      {groups.map((group, index) => (
        <div key={group[0]?.kind} {...props(styles.group)}>
          {index > 0 && design.dividers && <Divider lifted={connected} />}
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
                    tab.kind === "chat" && design.width === "shrink" && styles.slotShrink,
                    active && styles.slotActive,
                    active &&
                      tab.kind === "chat" &&
                      design.width === "shrink" &&
                      design.close === "beside" &&
                      styles.slotBeside,
                  )}
                >
                  <Tab
                    tab={tab}
                    position={tabs.indexOf(tab)}
                    active={active}
                    design={design}
                    onActivate={() => onActivate(tab.id)}
                    onClose={() => onClose(tab.id)}
                  />
                  {design.close === "beside" && active && tab.kind === "chat" && (
                    <span {...props(styles.beside, connected && styles.lift)}>
                      <Button
                        size="xs"
                        variant="ghost"
                        iconOnly
                        icon="x"
                        aria-label={`Close ${tab.title}`}
                        onClick={() => onClose(tab.id)}
                      />
                    </span>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ))}
      <span {...props(styles.add, connected && styles.lift)}>
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

const pulse = keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.35 },
  "100%": { opacity: 1 },
});

const styles = create({
  // Tabs stretch to the content box, so the gap is the one number above.
  strip: {
    display: "flex",
    alignItems: "stretch",
    gap: 2,
    flex: 1,
    minWidth: 0,
    height: "100%",
    paddingBlock: GAP,
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
  },
  // Opens the bottom and runs a pixel past the bar, so the active tab overlaps the card's hairline.
  stripConnected: {
    height: "calc(100% + 1px)",
    marginBottom: -1,
    paddingBottom: 0,
  },
  // What is not the active tab keeps the gap above the card in Connected mode.
  lift: { marginBottom: GAP + 1 },
  // No box of its own: every tab is a flex item of the strip, so only chat tabs give way.
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
  // Room for the title the active tab keeps, plus the close button after it.
  slotBeside: { minWidth: `calc(96px + ${button.heightXs} + 2px)` },
  tab: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    paddingInline: 8,
    borderRadius: button.radiusMd,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    cursor: "default",
    userSelect: "none",
    outline: "none",
    "--_reveal": { default: "0", ":hover": "1", ":focus-within": "1" },
    "--_ring": role.bgChrome,
    transitionProperty: "background-color, color, box-shadow",
    transitionDuration: motionTokens.durationNormal,
    transitionTimingFunction: motionTokens.easeOut,
  },
  // A size container, so the label can leave once the tab is squeezed to its icon.
  tabShrink: {
    containerType: "inline-size",
    justifyContent: { default: "flex-start", [COLLAPSED]: "center" },
    paddingInline: { default: 8, [COLLAPSED]: 0 },
  },
  tabShrinkActive: { minWidth: 96 },
  tabFixed: { width: 152, containerType: "inline-size" },
  tabFolder: { flexShrink: 0, maxWidth: 176 },
  tabPinned: { flexShrink: 0 },
  tabIconOnly: { width: button.heightMd, paddingInline: 0, justifyContent: "center" },
  chip: {
    backgroundColor: { default: role.bgMutedTranslucent, ":hover": role.bgHover },
  },
  ghost: {
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
  },
  // The card's own colour, top corners only; the feet below finish the join.
  activeConnected: {
    paddingBottom: 1,
    borderRadius: 0,
    borderStartStartRadius: radius.card,
    borderStartEndRadius: radius.card,
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    "--_ring": role.bgBase,
  },
  activeCard: {
    backgroundColor: role.bgBase,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    "--_ring": role.bgBase,
  },
  activeFlat: {
    backgroundColor: role.bgPressed,
    color: role.contentPrimary,
  },
  curve: {
    position: "absolute",
    bottom: 0,
    width: CORNER,
    height: CORNER,
    color: role.bgBase,
    pointerEvents: "none",
  },
  curveLeft: { left: -CORNER },
  curveRight: { right: -CORNER },
  glyph: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.box,
    height: glyph.box,
  },
  badgeHost: { position: "relative", display: "grid", placeItems: "center" },
  // The ring is the tab's own fill, so the dot reads as sitting on the icon and not under it.
  badgeRing: {
    position: "absolute",
    insetInlineEnd: -4,
    insetBlockEnd: -3,
    display: "grid",
    placeItems: "center",
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: "var(--_ring)",
  },
  badge: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimary,
  },
  badgePulse: {
    animationName: pulse,
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
  },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  labelCollapsible: {
    display: { default: "block", [COLLAPSED]: "none" },
  },
  collapsible: {
    display: { default: "inline-flex", [COLLAPSED]: "none" },
  },
  count: {
    flexShrink: 0,
    minWidth: glyph.box,
    paddingInline: 4,
    borderRadius: radius.pill,
    backgroundColor: role.bgHover,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: glyph.box,
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
  },
  trailingMark: { alignItems: "center", flexShrink: 0, color: role.contentTertiary },
  close: { alignItems: "center", flexShrink: 0, marginInlineEnd: -4 },
  closeOnHover: {
    opacity: "var(--_reveal)",
    transitionProperty: "opacity",
    transitionDuration: motionTokens.durationNormal,
  },
  // Dia's close: one button after the active tab, so no tab needs to hide one inside.
  beside: { display: "inline-flex", alignItems: "center", marginInlineStart: 2 },
  add: { display: "inline-flex", alignItems: "center", flexShrink: 0, marginInlineStart: 2 },
  divider: {
    flexShrink: 0,
    alignSelf: "center",
    width: 1,
    height: glyph.sm,
    marginInline: 4,
    borderRadius: radius.pill,
    backgroundColor: role.borderStrongTranslucent,
  },
  tip: { display: "inline-flex", alignItems: "center", gap: 8 },
});
