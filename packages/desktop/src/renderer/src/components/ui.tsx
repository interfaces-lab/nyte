/** Small shared controls, styled on the palette. */
import { Button as BaseButton } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Tooltip } from "@nyte-ai/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import { isValidElement } from "react";
import type { JSX, ReactElement, ReactNode } from "react";
import { layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import type { SessionMark } from "../chrome/sidebar-view.ts";
import { Icon, type IconName } from "./icons";
import { Spinner } from "./spinner.tsx";

/**
 * Keyboard focus must be visible to navigate at all: `ring` for standalone
 * controls, `ringInset` for rows and menu items that sit flush inside a
 * scroll container or popover, where an outset ring would clip.
 *
 * `t.focusRing` — not `:focus-visible` — is what keeps these off the mouse.
 * Chromium matches `:focus-visible` on every text field focus, so a plain
 * ring lands on any input the user clicked into; focus-modality.ts drops the
 * color to `transparent` until focus arrives by keyboard.
 */
export const focus = stylex.create({
  ring: {
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineColor: t.focusRing,
    outlineOffset: 1,
  },
  ringInset: {
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineColor: t.focusRing,
    outlineOffset: -2,
  },
});

/** Visually hidden, still announced: labels a control that reads by shape alone. */
const hidden = stylex.create({
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    borderWidth: 0,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
  },
});

export const srOnly = hidden.srOnly;

const styles = stylex.create({
  buttonBase: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 28,
    paddingBlock: 0,
    paddingInline: 10,
    borderRadius: t.radiusLg,
    borderStyle: "none",
    fontSize: t.fontBase,
    fontWeight: 500,
    lineHeight: t.leadingBase,
    cursor: { default: "pointer", ":disabled": "default" },
    whiteSpace: "nowrap",
    userSelect: "none",
    transitionProperty: "background-color, color, opacity",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
  },
  primary: {
    color: t.textOnPrimary,
    backgroundColor: {
      default: t.fillPrimary,
      ":hover:not(:disabled)": t.fillPrimaryHover,
      ":disabled": t.fillPrimaryDisabled,
    },
  },
  secondary: {
    color: t.textPrimary,
    backgroundColor: {
      default: t.fillSecondary,
      ":hover:not(:disabled)": t.fillSecondaryHover,
    },
    opacity: { ":disabled": 0.5 },
  },
  ghost: {
    color: t.textSecondary,
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": t.fillGhostHover,
    },
    opacity: { ":disabled": 0.5 },
  },
  danger: {
    color: t.textOnPrimary,
    backgroundColor: {
      default: t.fillDanger,
      ":hover:not(:disabled)": t.fillDangerHover,
    },
    opacity: { ":disabled": 0.5 },
  },
  iconButton: {
    width: 28,
    paddingInline: 0,
    flexShrink: 0,
    color: t.iconSecondary,
  },
  compactIconButton: { width: 24, height: 24 },
  statusDot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 8,
    height: 8,
    borderRadius: t.radiusFull,
    flexShrink: 0,
    pointerEvents: "none",
  },
  statusWorking: { width: 15, height: 15, color: t.textAccent },
  statusRetry: { width: 15, height: 15, color: t.textWarning },
  statusWaiting: { backgroundColor: t.textWarning },
  statusFailed: { backgroundColor: t.textDanger },
  statusIdle: { backgroundColor: "transparent" },
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    flexShrink: 0,
    minHeight: 18,
    paddingBlock: 1,
    paddingInline: 4,
    borderRadius: t.radiusBase,
    backgroundColor: t.fillSecondary,
    color: t.textSecondary,
    fontSize: t.fontSm,
    fontFamily: t.fontMono,
    fontWeight: 400,
    fontVariantLigatures: "none",
    letterSpacing: 0,
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
  },
  kbdPlain: { padding: 0, backgroundColor: "transparent" },
  tooltipPositioner: { zIndex: layer.tooltip, outline: "none" },
  tooltipPopup: {
    maxWidth: 260,
    paddingBlock: 4,
    paddingInline: 7,
    borderRadius: t.radiusBase,
    backgroundColor: t.bgElevated,
    boxShadow: `${t.shadowPopover}, inset 0 0 0 1px ${t.strokeSecondary}`,
    color: t.textSecondary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    whiteSpace: "pre-line",
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    scale: {
      default: 1,
      "[data-starting-style]": 0.98,
      "[data-ending-style]": 0.98,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionDuration: {
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
});

type HintSide = Tooltip.Positioner.Props["side"];
type HintAlign = Tooltip.Positioner.Props["align"];

export function Hint({
  content,
  trigger,
  side = "bottom",
  align = "center",
}: {
  readonly content: ReactNode;
  readonly trigger: ReactElement;
  readonly side?: HintSide;
  readonly align?: HintAlign;
}): ReactElement {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner
          positionMethod="fixed"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          {...stylex.props(styles.tooltipPositioner)}
        >
          <Tooltip.Popup {...stylex.props(styles.tooltipPopup)}>{content}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends Omit<JSX.IntrinsicElements["button"], "className" | "style"> {
  variant?: ButtonVariant;
  icon?: IconName;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  icon,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <BaseButton
      disabled={disabled}
      render={<button type={type} {...rest} />}
      {...stylex.props(styles.buttonBase, focus.ring, styles[variant])}
    >
      {icon !== undefined && <Icon name={icon} size={14} />}
      {children}
    </BaseButton>
  );
}

interface IconButtonProps extends Omit<JSX.IntrinsicElements["button"], "className" | "style"> {
  icon: IconName | ReactElement;
  label: string;
  size?: number;
  compact?: boolean;
}

interface ToggleIconButtonProps extends Omit<IconButtonProps, "aria-pressed" | "onClick"> {
  readonly pressed: boolean;
  readonly onPressedChange: (pressed: boolean) => void;
}

export function IconButton({
  icon,
  label,
  size = 15,
  compact = false,
  type = "button",
  disabled,
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <BaseButton
      disabled={disabled}
      render={<button type={type} {...rest} />}
      aria-label={label}
      title={label}
      {...stylex.props(
        styles.buttonBase,
        focus.ring,
        styles.ghost,
        styles.iconButton,
        compact && styles.compactIconButton,
      )}
    >
      {isValidElement(icon) ? icon : <Icon name={icon} size={size} />}
    </BaseButton>
  );
}

export function ToggleIconButton({
  icon,
  label,
  size = 15,
  compact = false,
  pressed,
  onPressedChange,
  type = "button",
  disabled,
  ...rest
}: ToggleIconButtonProps): ReactElement {
  return (
    <Toggle
      pressed={pressed}
      disabled={disabled}
      onPressedChange={onPressedChange}
      render={<button type={type} {...rest} />}
      aria-label={label}
      title={label}
      {...stylex.props(
        styles.buttonBase,
        focus.ring,
        styles.ghost,
        styles.iconButton,
        compact && styles.compactIconButton,
      )}
    >
      {isValidElement(icon) ? icon : <Icon name={icon} size={size} />}
    </Toggle>
  );
}

export function HintIconButton({
  hint,
  hintSide,
  hintAlign,
  ...button
}: IconButtonProps & {
  readonly hint?: ReactNode;
  readonly hintSide?: HintSide;
  readonly hintAlign?: HintAlign;
}): ReactElement {
  return (
    <Hint
      content={hint ?? button.label}
      side={hintSide}
      align={hintAlign}
      trigger={<IconButton {...button} title={undefined} />}
    />
  );
}

export function HintToggleIconButton({
  hint,
  hintSide,
  hintAlign,
  ...button
}: ToggleIconButtonProps & {
  readonly hint?: ReactNode;
  readonly hintSide?: HintSide;
  readonly hintAlign?: HintAlign;
}): ReactElement {
  return (
    <Hint
      content={hint ?? button.label}
      side={hintSide}
      align={hintAlign}
      trigger={<ToggleIconButton {...button} title={undefined} />}
    />
  );
}

const STATUS_MARK_LABEL = {
  idle: "Idle",
  working: "Running",
  waiting: "Needs attention",
  retry: "Retrying",
  failed: "Failed",
} as const satisfies Readonly<Record<SessionMark, string>>;

function statusMarkStyle(mark: SessionMark) {
  switch (mark) {
    case "working":
      return styles.statusWorking;
    case "retry":
      return styles.statusRetry;
    case "waiting":
      return styles.statusWaiting;
    case "failed":
      return styles.statusFailed;
    case "idle":
      return styles.statusIdle;
    default: {
      const _exhaustive: never = mark;
      return _exhaustive;
    }
  }
}

export function StatusDot({ mark }: { mark: SessionMark }): ReactElement {
  return (
    <span
      role="img"
      aria-label={STATUS_MARK_LABEL[mark]}
      {...stylex.props(styles.statusDot, statusMarkStyle(mark))}
    >
      {(mark === "working" || mark === "retry") && <Spinner />}
    </span>
  );
}

export function Kbd({
  keys,
  plain = false,
}: {
  readonly keys: readonly string[];
  readonly plain?: boolean;
}): ReactElement {
  return (
    <kbd {...stylex.props(styles.kbd, plain && styles.kbdPlain)}>
      {keys.map((key) => (
        <span key={key}>{key}</span>
      ))}
    </kbd>
  );
}

/** "2m ago" for lists; bare clock time within today. */
export function formatTimeAgo(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
