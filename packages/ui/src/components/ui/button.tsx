/**
 * The button library: `Button`, and `Toggle` for anything with an on state.
 * A caller picks a variant and a size and may place the control through
 * `xstyle`, never restyle it.
 *
 * The sizes are one stair, read off the controls the app had grown by hand:
 * text stands 30, 28 condensed, or 24; icon-only controls are 28, 24, or 16
 * squares. Variants are named by use, so `primary` is the one reached for
 * most: a bare label or glyph that lifts on hover.
 */
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { create, props, type StyleXStyles } from "@stylexjs/stylex";
import type { CSSProperties, JSX, ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { mergeStyleProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
import { Icon, type IconName } from "./icon.tsx";

const button = create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    flexShrink: 0,
    paddingBlock: 0,
    borderRadius: t.radiusBase,
    borderStyle: "none",
    backgroundColor: "transparent",
    // Hover and press lay a state over the variant's own fill.
    backgroundImage: {
      default: "none",
      ":hover:not(:disabled)": t.layerHover,
      ":active:not(:disabled)": t.layerPressed,
    },
    fontWeight: 500,
    cursor: { default: t.cursorInteractive, ":disabled": "default" },
    whiteSpace: "nowrap",
    userSelect: "none",
    opacity: { default: 1, ":disabled": 0.5 },
    transitionProperty: "background-color, color, opacity",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
  },
  round: { borderRadius: t.radiusFull },
});

const buttonSizes = create({
  default: { height: 30, paddingInline: 12, fontSize: t.fontBase, lineHeight: t.leadingBase },
  condensed: { height: 28, paddingInline: 8, fontSize: t.fontBase, lineHeight: t.leadingBase },
  sm: { height: 24, paddingInline: 6, fontSize: t.fontSm, lineHeight: t.leadingSm },
  icon: { width: 28, height: 28, paddingInline: 0 },
  "icon-sm": { width: 24, height: 24, paddingInline: 0 },
  "icon-xs": { width: 16, height: 16, paddingInline: 0, borderRadius: t.radiusSm },
});

const buttonVariants = create({
  // A pressed toggle and a trigger whose menu or panel is open read the same.
  primary: {
    color: {
      default: t.textSecondary,
      ":hover:not(:disabled)": t.textPrimary,
      "[data-pressed]": t.textPrimary,
      '[aria-expanded="true"]': t.textPrimary,
    },
    backgroundColor: {
      default: "transparent",
      "[data-pressed]": t.fillSelected,
      '[aria-expanded="true"]': t.fillSelected,
    },
  },
  /** A toggle whose glyph already draws its state, like a panel's open/closed icon. */
  glyphPressed: {
    backgroundColor: "transparent",
    color: { default: t.iconSecondary, ":hover:not(:disabled)": t.iconPrimary },
  },
  secondary: {
    color: t.textPrimary,
    backgroundImage: {
      default: t.buttonSecondaryBg,
      ":hover:not(:disabled)": `${t.layerHover}, ${t.buttonSecondaryBg}`,
      ":active:not(:disabled)": `${t.layerPressed}, ${t.buttonSecondaryBg}`,
    },
    boxShadow: `inset 0 0 0 1px ${t.strokeSecondary}, ${t.shadowButton}`,
  },
  inverse: {
    // Disabled keeps its glyph readable on the strong fill instead of fading.
    color: { default: t.textOnInverse, ":disabled": t.textQuaternary },
    backgroundColor: { default: t.fillInverse, ":disabled": t.fillStrong },
    opacity: 1,
  },
  danger: { color: t.textOnColor, backgroundColor: t.fillDanger },
  link: {
    height: "auto",
    paddingInline: 0,
    backgroundImage: "none",
    color: t.textAccent,
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    textDecoration: { default: "none", ":hover:not(:disabled)": "underline" },
  },
});

/** A glyph on the bare variant: quieter in the smaller boxes that sit inside rows. */
const iconButtonTones = create({
  default: {
    color: {
      default: t.iconSecondary,
      ":hover:not(:disabled)": t.iconPrimary,
      "[data-pressed]": t.iconPrimary,
      '[aria-expanded="true"]': t.iconPrimary,
    },
  },
  quiet: {
    color: {
      default: t.iconTertiary,
      ":hover:not(:disabled)": t.iconPrimary,
      "[data-pressed]": t.iconPrimary,
      '[aria-expanded="true"]': t.iconPrimary,
    },
  },
});

export type ButtonVariant = Exclude<keyof typeof buttonVariants, "glyphPressed">;

export type ButtonSize = keyof typeof buttonSizes;

type IconSize = Extract<ButtonSize, `icon${string}`>;

/** An icon-only control has no text to name it, so its size demands a label. */
export type ButtonSizing =
  | { readonly size?: Exclude<ButtonSize, IconSize> }
  | { readonly size: IconSize; readonly "aria-label": string };

/** Where a control sits. How it looks belongs to its variant and size. */
export type ButtonLayout = StyleXStyles<{
  position?: "static" | "relative" | "absolute" | "sticky";
  inset?: number | string;
  insetBlock?: number | string;
  insetBlockStart?: number | string;
  insetBlockEnd?: number | string;
  insetInline?: number | string;
  insetInlineStart?: number | string;
  insetInlineEnd?: number | string;
  zIndex?: number;
  margin?: number | string;
  marginBlock?: number | string;
  marginBlockStart?: number | string;
  marginBlockEnd?: number | string;
  marginInline?: number | string;
  marginInlineStart?: number | string;
  marginInlineEnd?: number | string;
  flex?: number | string;
  flexGrow?: number;
  flexShrink?: number;
  alignSelf?: string;
  justifySelf?: string;
  gridArea?: string;
  gridColumn?: number | string;
  gridRow?: number | string;
  order?: number;
  width?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
}>;

export type ButtonElementProps = Omit<JSX.IntrinsicElements["button"], "className" | "style">;

export interface ButtonAppearance {
  readonly round?: boolean;
  /** A leading glyph, or the whole content of an icon-only control. */
  readonly icon?: IconName;
  readonly xstyle?: ButtonLayout;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export type ButtonProps = ButtonElementProps &
  ButtonSizing &
  ButtonAppearance & { readonly variant?: ButtonVariant };

export const buttonGlyphSize = {
  default: 14,
  condensed: 14,
  sm: 12,
  icon: 16,
  "icon-sm": 14,
  "icon-xs": 12,
} as const satisfies Record<ButtonSize, number>;

function isIconSize(size: ButtonSize): size is IconSize {
  return size.startsWith("icon");
}

export function buttonStyle(
  variant: ButtonVariant,
  size: ButtonSize,
  { round = false, xstyle, className, style }: ButtonAppearance,
  glyphPressed = false,
) {
  return mergeStyleProps(
    props(
      button.base,
      buttonSizes[size],
      buttonVariants[variant],
      variant === "primary" &&
        isIconSize(size) &&
        iconButtonTones[size === "icon" ? "default" : "quiet"],
      round && button.round,
      // The 16px square sits inside rows, where an outset ring would clip.
      size === "icon-xs" ? focus.ringInset : focus.ring,
      xstyle,
      glyphPressed && buttonVariants.glyphPressed,
    ),
    className,
    style,
  );
}

/**
 * An icon-only control shows its label as the native tooltip. One wrapped in
 * a `Hint` passes `title={undefined}`, which wins over this default.
 */
export function tooltipTitle(size: ButtonSize, label: string | undefined): string | undefined {
  return isIconSize(size) ? label : undefined;
}

export function Button({
  variant = "primary",
  size = "default",
  round,
  icon,
  xstyle,
  className,
  style,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <ButtonPrimitive
      disabled={disabled}
      render={<button type={type} title={tooltipTitle(size, rest["aria-label"])} {...rest} />}
      {...buttonStyle(variant, size, { round, xstyle, className, style })}
    >
      {icon !== undefined && <Icon name={icon} size={buttonGlyphSize[size]} />}
      {children}
    </ButtonPrimitive>
  );
}
