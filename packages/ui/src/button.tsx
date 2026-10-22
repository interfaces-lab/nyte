import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { create, props } from "@stylexjs/stylex";
import {
  createContext,
  use,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import { focus } from "./styles/a11y.stylex.ts";
import { button, media, radius, space, target } from "./styles/schema.stylex.ts";
import {
  mergeStyleProps,
  type StateStyledProps,
  type StaticStyleProps,
  type StyledProps,
  type XStyle,
} from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { intent } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, motion, role, shadow, type } from "./styles/vars.stylex.ts";
import { ControlGlyphs, Icon, type IconName } from "./icon.tsx";
import { Spinner } from "./spinner.tsx";

const control = create({
  base: {
    "--_btn-hit-inset": `calc(max(0px, ${target.min} - var(--_btn-height)) / 2)`,
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    flexShrink: 0,
    height: "var(--_btn-height)",
    minWidth: target.min,
    marginBlock: "var(--_btn-hit-inset)",
    paddingBlock: 0,
    borderRadius: "var(--_btn-radius)",
    borderStyle: "none",
    backgroundColor: "transparent",
    backgroundImage: {
      default: "none",
      ":hover:not([data-disabled])": {
        [media.hover]: role.layerHover,
      },
      ":active:not([data-disabled])": role.layerPressed,
    },
    fontWeight: type.weightMedium,
    cursor: {
      default: appearance.cursorInteractive,
      "[data-disabled]": "default",
    },
    whiteSpace: "nowrap",
    userSelect: "none",
    textDecoration: "none",
    color: {
      default: role.contentSecondary,
      ":hover:not([data-disabled])": {
        [media.hover]: role.contentPrimary,
      },
      ":active:not([data-disabled])": role.contentPrimary,
      "[data-pressed]:not([data-disabled])": role.contentPrimary,
      '[aria-expanded="true"]:not([data-disabled])': role.contentPrimary,
    },
    scale: { default: "1", ":active:not([data-disabled])": "0.97" },
    touchAction: "manipulation",
    transitionProperty: "background-color, color, opacity, scale",
    transitionDuration: {
      default: motion.durationFast,
      ":active:not([data-disabled])": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
    "::before": {
      content: '""',
      position: "absolute",
      insetBlock: "calc(-1 * var(--_btn-hit-inset))",
      insetInline: 0,
    },
  },
  iconOnly: {
    width: "var(--_btn-height)",
    minWidth: 0,
    marginInline: "var(--_btn-hit-inset)",
    paddingInline: button.iconPaddingInline,
    "::before": { insetInline: "calc(-1 * var(--_btn-hit-inset))" },
  },
  joined: {
    "--_btn-hit-inset": "0px",
    height: `max(var(--_btn-height), ${target.min})`,
    borderStartStartRadius: { default: 0, ":first-of-type": "var(--_btn-radius)" },
    borderEndStartRadius: { default: 0, ":first-of-type": "var(--_btn-radius)" },
    borderStartEndRadius: { default: 0, ":last-of-type": "var(--_btn-radius)" },
    borderEndEndRadius: { default: 0, ":last-of-type": "var(--_btn-radius)" },
    "::after": {
      content: { default: '""', ":first-of-type": "none" },
      position: "absolute",
      insetBlock: space.s1,
      insetInlineStart: 0,
      width: 1,
      backgroundColor: role.borderPrimary,
      pointerEvents: "none",
    },
  },
  joinedIcon: { width: `max(var(--_btn-height), ${target.min})` },
  pill: { borderRadius: radius.pill },
  dimmed: { opacity: { default: null, "[data-disabled]:not([aria-busy='true'])": 0.5 } },
});

const group = create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: 0,
    minWidth: 0,
    flexWrap: "wrap",
    opacity: { default: 1, ":has([data-disabled]:not([aria-busy='true']))": 0.5 },
  },
});

const ButtonGroupContext = createContext(false);

const buttonSizes = create({
  "2xs": {
    "--_btn-radius": button.radius2xs,
    "--_btn-height": button.height2xs,
    paddingInline: button.paddingInline2xs,
    gap: button.gap2xs,
  },
  xs: {
    "--_btn-radius": button.radiusXs,
    "--_btn-height": button.heightXs,
    paddingInline: button.paddingInlineXs,
    gap: button.gapXs,
  },
  sm: {
    "--_btn-radius": button.radiusSm,
    "--_btn-height": button.heightSm,
    paddingInline: button.paddingInlineSm,
    gap: button.gapSm,
  },
  md: {
    "--_btn-radius": button.radiusMd,
    "--_btn-height": button.heightMd,
    paddingInline: button.paddingInlineMd,
    gap: button.gapMd,
  },
  lg: {
    "--_btn-radius": button.radiusLg,
    "--_btn-height": button.heightLg,
    paddingInline: button.paddingInlineLg,
    gap: button.gapLg,
  },
  xl: {
    "--_btn-radius": button.radiusXl,
    "--_btn-height": button.heightXl,
    paddingInline: button.paddingInlineXl,
    gap: button.gapXl,
  },
});

const pillSizes = create({
  "2xs": { paddingInline: button.pillPaddingInline2xs },
  xs: { paddingInline: button.pillPaddingInlineXs },
  sm: { paddingInline: button.pillPaddingInlineSm },
  md: { paddingInline: button.pillPaddingInlineMd },
  lg: { paddingInline: button.pillPaddingInlineLg },
  xl: { paddingInline: button.pillPaddingInlineXl },
});

const ghostFill = {
  default: "transparent",
  "[data-pressed]": role.bgInteractiveSecondaryTranslucent,
  '[aria-expanded="true"]': role.bgInteractiveSecondaryTranslucent,
} as const;

const buttonVariants = create({
  ghost: { backgroundColor: ghostFill },
  outline: {
    backgroundColor: role.bgElevated,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimary}, ${shadow.shadowSm}`,
  },
  solid: {
    color: role.contentOnInteractiveStrong,
    backgroundColor: {
      default: role.buttonFill,
      ":hover:not([data-disabled])": {
        [media.hover]: role.buttonFillHover,
      },
      ":active:not([data-disabled])": role.buttonFillPressed,
    },
    backgroundImage: "none",
  },
  plain: {
    fontWeight: type.weightRegular,
    backgroundImage: "none",
    backgroundColor: {
      default: "transparent",
      '[aria-expanded="true"]': role.bgInteractiveSecondaryTranslucent,
    },
  },
  text: {
    paddingInline: 0,
    backgroundImage: "none",
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    textDecoration: {
      default: "none",
      ":hover:not([data-disabled])": { [media.hover]: "underline" },
    },
  },
  inline: {
    "--_btn-hit-inset": "0px",
    "--_btn-inline-hover": {
      default: "transparent",
      ":hover:not([data-disabled])": {
        [media.hover]: role.bgInteractiveSecondaryTranslucent,
      },
    },
    zIndex: 0,
    alignItems: "baseline",
    height: "auto",
    minWidth: 0,
    paddingInline: 0,
    verticalAlign: "baseline",
    backgroundImage: "none",
    color: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    letterSpacing: "inherit",
    transitionDuration: motion.durationNormal,
    "::before": {
      zIndex: -1,
      insetBlock: `calc(${space.px} * -1)`,
      insetInline: -3,
      borderRadius: radius.indicator,
      backgroundColor: "var(--_btn-inline-hover)",
      transitionProperty: "background-color",
      transitionDuration: motion.durationNormal,
    },
  },
});

const contentStyles = create({
  content: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "inherit",
  },
  loading: { opacity: 0 },
  spinner: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  glyphPressed: { backgroundColor: "transparent", backgroundImage: "none" },
});

export type ButtonVariant = keyof typeof buttonVariants;

type ButtonTone = "neutral" | keyof typeof intent;

export type ButtonSize = keyof typeof buttonSizes;

export type ButtonSizing = { readonly size?: ButtonSize; readonly pill?: boolean } & (
  | { readonly iconOnly?: false; readonly children: ReactNode; readonly "aria-label"?: never }
  | { readonly iconOnly: true; readonly children?: ReactNode; readonly "aria-label": string }
);

export type ButtonLayout = Restyle<"Button">;

export interface ButtonAppearance {
  readonly icon?: IconName;
  readonly tone?: ButtonTone;
  readonly xstyle?: ButtonLayout;
}

export type ButtonProps = Omit<
  StyledProps<ButtonPrimitive.Props>,
  "xstyle" | "children" | "aria-label"
> &
  ButtonSizing &
  ButtonAppearance & {
    readonly variant?: ButtonVariant;
    readonly loading?: boolean;
    readonly disabledReason?: string;
  };

const glyphSizes = {
  text: { "2xs": 12, xs: 12, sm: 14, md: 14, lg: 14, xl: 16 },
  iconOnly: { "2xs": 12, xs: 12, sm: 14, md: 16, lg: 16, xl: 18 },
} as const satisfies Record<string, Record<ButtonSize, number>>;

export function buttonGlyphSize(size: ButtonSize, iconOnly: boolean): number {
  return glyphSizes[iconOnly ? "iconOnly" : "text"][size];
}

type ButtonStyleOptions = ButtonAppearance & {
  readonly iconOnly?: boolean;
  readonly joined?: boolean;
  readonly pill?: boolean;
  readonly xstyle?: XStyle;
};

export function buttonStyle(
  variant: ButtonVariant,
  size: ButtonSize,
  options: ButtonStyleOptions & { readonly className?: string; readonly style?: CSSProperties },
  glyphPressed?: boolean,
): StaticStyleProps;
export function buttonStyle<State>(
  variant: ButtonVariant,
  size: ButtonSize,
  options: ButtonStyleOptions & StateStyledProps<State>,
  glyphPressed?: boolean,
): StateStyledProps<State>;
export function buttonStyle<State>(
  variant: ButtonVariant,
  size: ButtonSize,
  {
    iconOnly = false,
    joined = false,
    pill = false,
    tone = variant === "text" ? "primary" : "neutral",
    xstyle,
    className,
    style,
  }: ButtonStyleOptions & StateStyledProps<State>,
  glyphPressed = false,
): StateStyledProps<State> {
  return mergeStyleProps(
    props(
      size === "2xs" || size === "xs" ? text.sm : text.base,
      tone !== "neutral" && intent[tone],
      control.base,
      buttonSizes[size],
      pill && pillSizes[size],
      iconOnly && control.iconOnly,
      buttonVariants[variant],
      pill && control.pill,
      joined && control.joined,
      joined && iconOnly && control.joinedIcon,
      size === "2xs" ? focus.ringInset : focus.ring,
      xstyle,
      glyphPressed && contentStyles.glyphPressed,
      !joined && control.dimmed,
    ),
    className,
    style,
  );
}

export function tooltipTitle(iconOnly: boolean, label: string | undefined): string | undefined {
  return iconOnly ? label : undefined;
}

function ButtonContent({
  icon,
  size,
  iconOnly,
  children,
  loading = false,
}: Pick<ButtonAppearance, "icon"> & {
  readonly size: ButtonSize;
  readonly iconOnly: boolean;
  readonly children: ReactNode;
  readonly loading?: boolean;
}): ReactElement {
  return (
    <ControlGlyphs>
      <span {...props(contentStyles.content, loading && contentStyles.loading)}>
        {icon !== undefined && <Icon name={icon} size={buttonGlyphSize(size, iconOnly)} />}
        {children}
      </span>
      {loading && (
        <span aria-hidden="true" {...props(contentStyles.spinner)}>
          <Spinner />
        </span>
      )}
    </ControlGlyphs>
  );
}

export function Button({
  variant = "ghost",
  size = "md",
  iconOnly = false,
  pill = false,
  icon,
  tone,
  xstyle,
  className,
  style,
  children,
  disabled = false,
  disabledReason,
  loading = false,
  ...rest
}: ButtonProps): ReactElement {
  const joined = use(ButtonGroupContext);
  const showReason = disabled && disabledReason !== undefined;

  return (
    <ButtonPrimitive
      title={showReason ? disabledReason : tooltipTitle(iconOnly, rest["aria-label"])}
      aria-busy={loading || undefined}
      focusableWhenDisabled={showReason || loading}
      {...rest}
      disabled={disabled || loading}
      {...buttonStyle(variant, size, { iconOnly, joined, pill, tone, xstyle, className, style })}
    >
      <ButtonContent icon={icon} size={size} iconOnly={iconOnly} loading={loading}>
        {children}
      </ButtonContent>
    </ButtonPrimitive>
  );
}

const picker = create({
  trigger: { maxWidth: 180 },
  value: {
    display: "block",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    fontFamily: "inherit",
    textOverflow: "ellipsis",
    textAlign: "start",
    whiteSpace: "nowrap",
  },
});

const pickerWidths = create({
  standard: {},
  wide: { maxWidth: "100%" },
});

export type PickerTriggerProps = Omit<StyledProps<ButtonPrimitive.Props>, "xstyle"> & {
  readonly width?: keyof typeof pickerWidths;
  readonly xstyle?: ButtonLayout;
};

export function PickerTrigger({
  width = "standard",
  children,
  xstyle,
  className,
  style,
  ...rest
}: PickerTriggerProps): ReactElement {
  return (
    <ButtonPrimitive
      {...rest}
      {...buttonStyle("outline", "md", {
        xstyle: [picker.trigger, pickerWidths[width], xstyle],
        className,
        style,
      })}
    >
      <ControlGlyphs>
        <span {...props(picker.value)}>{children}</span>
        <Icon name="chevron-down" size={12} />
      </ControlGlyphs>
    </ButtonPrimitive>
  );
}

export function ButtonLink({
  variant = "ghost",
  size = "md",
  iconOnly = false,
  pill = false,
  icon,
  tone,
  xstyle,
  className,
  style,
  children,
  ...rest
}: Omit<StyledProps<ComponentProps<"a">>, "xstyle" | "children" | "aria-label" | "href"> &
  ButtonSizing &
  ButtonAppearance & {
    readonly href: string;
    readonly variant?: ButtonVariant;
  }): ReactElement {
  const joined = use(ButtonGroupContext);

  return (
    <a
      title={tooltipTitle(iconOnly, rest["aria-label"])}
      {...rest}
      {...buttonStyle(variant, size, { iconOnly, joined, pill, tone, xstyle, className, style })}
    >
      <ButtonContent icon={icon} size={size} iconOnly={iconOnly}>
        {children}
      </ButtonContent>
    </a>
  );
}

export function ButtonGroup({
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<ComponentProps<"div">, Restyle<"ButtonGroup">>): ReactElement {
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

function SplitButtonMenuTrigger({
  icon = "chevron-down",
  ...rest
}: Omit<ButtonProps, "iconOnly" | "children" | "aria-label"> & {
  readonly "aria-label": string;
}): ReactElement {
  return <Button {...rest} icon={icon} iconOnly />;
}

export const SplitButton = { Root: ButtonGroup, Main: Button, MenuTrigger: SplitButtonMenuTrigger };
