/**
 * The button library: `Button`, and `Toggle` for anything with an on state.
 * A caller picks a variant and a size and may place the control through
 * `xstyle`, never restyle it.
 *
 * Sizes are Notion Calendar's, 2xs to xl, and grow under a coarse pointer.
 * `iconOnly` squares the box for a glyph with no text. Variants are named by
 * use, so `primary` is the one reached for most: a bare label or glyph that
 * lifts on hover. The filled `inverse` and `danger` paint inside their intent.
 * A `ButtonGroup` joins buttons into one control, such as an action beside the
 * menu of its siblings.
 */
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { create, props, type StyleXStyles } from "@stylexjs/stylex";
import { createContext, use, type CSSProperties, type JSX, type ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { button } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { intent } from "../../surface-theme.ts";
import { t } from "../../vars.stylex.ts";
import { Icon, type IconName } from "./icon.tsx";

const control = create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    paddingBlock: 0,
    borderRadius: "var(--_btn-radius)",
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
  // Only the group's outer corners round. By type, because an open menu's focus guards are spans.
  joined: {
    borderStartStartRadius: { default: 0, ":first-of-type": "var(--_btn-radius)" },
    borderEndStartRadius: { default: 0, ":first-of-type": "var(--_btn-radius)" },
    borderStartEndRadius: { default: 0, ":last-of-type": "var(--_btn-radius)" },
    borderEndEndRadius: { default: 0, ":last-of-type": "var(--_btn-radius)" },
  },
});

const group = create({
  // The hairline gap shows the surface through, dividing the parts.
  base: { display: "inline-flex", gap: 1, minWidth: 0 },
});

const ButtonGroupContext = createContext(false);

const buttonSizes = create({
  "2xs": {
    "--_btn-radius": button.radius2xs,
    height: button.height2xs,
    paddingInline: button.paddingInline2xs,
    gap: button.gap2xs,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  xs: {
    "--_btn-radius": button.radiusXs,
    height: button.heightXs,
    paddingInline: button.paddingInlineXs,
    gap: button.gapXs,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  sm: {
    "--_btn-radius": button.radiusSm,
    height: button.heightSm,
    paddingInline: button.paddingInlineSm,
    gap: button.gapSm,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  md: {
    "--_btn-radius": button.radiusMd,
    height: button.heightMd,
    paddingInline: button.paddingInlineMd,
    gap: button.gapMd,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  lg: {
    "--_btn-radius": button.radiusLg,
    height: button.heightLg,
    paddingInline: button.paddingInlineLg,
    gap: button.gapLg,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  xl: {
    "--_btn-radius": button.radiusXl,
    height: button.heightXl,
    paddingInline: button.paddingInlineXl,
    gap: button.gapXl,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
});

/** A pill keeps its text clear of the rounded ends. */
const pillSizes = create({
  "2xs": { paddingInline: button.pillPaddingInline2xs },
  xs: { paddingInline: button.pillPaddingInlineXs },
  sm: { paddingInline: button.pillPaddingInlineSm },
  md: { paddingInline: button.pillPaddingInlineMd },
  lg: { paddingInline: button.pillPaddingInlineLg },
  xl: { paddingInline: button.pillPaddingInlineXl },
});

const iconOnlySizes = create({
  "2xs": { width: button.height2xs, paddingInline: button.iconPaddingInline },
  xs: { width: button.heightXs, paddingInline: button.iconPaddingInline },
  sm: { width: button.heightSm, paddingInline: button.iconPaddingInline },
  md: { width: button.heightMd, paddingInline: button.iconPaddingInline },
  lg: { width: button.heightLg, paddingInline: button.iconPaddingInline },
  xl: { width: button.heightXl, paddingInline: button.iconPaddingInline },
});

const filled = {
  color: t.contentOnInteractiveStrong,
  backgroundColor: {
    default: t.buttonFill,
    ":hover:not(:disabled)": t.buttonFillHover,
    ":active:not(:disabled)": t.buttonFillPressed,
  },
  backgroundImage: "none",
};

const buttonVariants = create({
  // A pressed toggle and a trigger whose menu or panel is open read the same.
  primary: {
    color: {
      default: t.contentInteractiveSecondary,
      ":hover:not(:disabled)": t.contentInteractivePrimary,
      "[data-pressed]": t.contentInteractivePrimary,
      '[aria-expanded="true"]': t.contentInteractivePrimary,
    },
    backgroundColor: {
      default: "transparent",
      "[data-pressed]": t.bgInteractiveSecondaryTranslucent,
      '[aria-expanded="true"]': t.bgInteractiveSecondaryTranslucent,
    },
  },
  /** A toggle whose glyph already draws its state, like a panel's open/closed icon. */
  glyphPressed: {
    backgroundColor: "transparent",
    color: {
      default: t.contentInteractiveSecondary,
      ":hover:not(:disabled)": t.contentInteractivePrimary,
    },
  },
  secondary: {
    color: t.contentInteractivePrimary,
    backgroundColor: t.bgElevated,
    boxShadow: `inset 0 0 0 1px ${t.borderPrimaryTranslucent}, ${t.shadowSm}`,
  },
  inverse: filled,
  danger: filled,
  context: {
    fontWeight: 400,
    backgroundImage: "none",
    color: {
      default: t.contentInteractiveSecondary,
      ":hover:not(:disabled)": t.contentInteractivePrimary,
      '[aria-expanded="true"]': t.contentInteractivePrimary,
    },
    backgroundColor: {
      default: "transparent",
      '[aria-expanded="true"]': t.bgInteractiveSecondaryTranslucent,
    },
  },
  link: {
    height: "auto",
    paddingInline: 0,
    backgroundImage: "none",
    color: t.intentPrimaryContent,
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
      default: t.contentInteractiveSecondary,
      ":hover:not(:disabled)": t.contentInteractivePrimary,
      "[data-pressed]": t.contentInteractivePrimary,
      '[aria-expanded="true"]': t.contentInteractivePrimary,
    },
  },
  quiet: {
    color: {
      default: t.contentInteractiveTertiary,
      ":hover:not(:disabled)": t.contentInteractivePrimary,
      "[data-pressed]": t.contentInteractivePrimary,
      '[aria-expanded="true"]': t.contentInteractivePrimary,
    },
  },
});

export type ButtonVariant = Exclude<keyof typeof buttonVariants, "glyphPressed">;

export type ButtonSize = keyof typeof buttonSizes;

/** An icon-only control has no text to name it, so it demands a label. */
export type ButtonSizing = { readonly size?: ButtonSize } & (
  | { readonly iconOnly?: false }
  | { readonly iconOnly: true; readonly "aria-label": string }
);

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

const glyphSizes = {
  text: { "2xs": 12, xs: 12, sm: 14, md: 14, lg: 14, xl: 16 },
  iconOnly: { "2xs": 12, xs: 12, sm: 14, md: 16, lg: 16, xl: 18 },
} as const satisfies Record<string, Record<ButtonSize, number>>;

export function buttonGlyphSize(size: ButtonSize, iconOnly: boolean): number {
  return glyphSizes[iconOnly ? "iconOnly" : "text"][size];
}

const filledIntent = { inverse: intent.primary, danger: intent.danger } as const;

export function buttonStyle(
  variant: ButtonVariant,
  size: ButtonSize,
  {
    iconOnly = false,
    round = false,
    joined = false,
    xstyle,
    className,
    style,
  }: ButtonAppearance & { readonly iconOnly?: boolean; readonly joined?: boolean },
  glyphPressed = false,
) {
  return mergeStyleProps(
    props(
      control.base,
      buttonSizes[size],
      round && pillSizes[size],
      iconOnly && iconOnlySizes[size],
      buttonVariants[variant],
      (variant === "inverse" || variant === "danger") && filledIntent[variant],
      variant === "primary" &&
        iconOnly &&
        iconButtonTones[size === "md" || size === "lg" || size === "xl" ? "default" : "quiet"],
      round && control.round,
      joined && control.joined,
      // The 2xs square sits inside rows, where an outset ring would clip.
      size === "2xs" ? focus.ringInset : focus.ring,
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
export function tooltipTitle(iconOnly: boolean, label: string | undefined): string | undefined {
  return iconOnly ? label : undefined;
}

export function Button({
  variant = "primary",
  size = "md",
  iconOnly = false,
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
  const joined = use(ButtonGroupContext);

  return (
    <ButtonPrimitive
      disabled={disabled}
      render={<button type={type} title={tooltipTitle(iconOnly, rest["aria-label"])} {...rest} />}
      {...buttonStyle(variant, size, { iconOnly, round, joined, xstyle, className, style })}
    >
      {icon !== undefined && <Icon name={icon} size={buttonGlyphSize(size, iconOnly)} />}
      {children}
    </ButtonPrimitive>
  );
}

export type ButtonGroupProps = StyledProps<JSX.IntrinsicElements["div"]>;

/** Joins the `Button`s inside it into one control, including one that triggers a menu. */
export function ButtonGroup({
  xstyle,
  className,
  style,
  children,
  ...rest
}: ButtonGroupProps): ReactElement {
  return (
    <div
      role="group"
      data-slot="button-group"
      {...rest}
      {...mergeStyleProps(props(group.base, xstyle), className, style)}
    >
      <ButtonGroupContext value={true}>{children}</ButtonGroupContext>
    </div>
  );
}
