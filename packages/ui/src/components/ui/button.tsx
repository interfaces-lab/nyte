import { create, props, type StyleXStyles } from "@stylexjs/stylex";
import {
  createContext,
  use,
  useId,
  type CSSProperties,
  type JSX,
  type ReactElement,
  type ReactNode,
} from "react";

import { focus } from "../../a11y.stylex.ts";
import { button, shape } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { intent } from "../../surface-theme.ts";
import { appearance, motion, role, shadow, type } from "../../vars.stylex.ts";
import { ControlGlyphs, Icon, type IconName } from "./icon.tsx";
import { Spinner } from "./spinner.tsx";

const control = create({
  base: {
    "--_btn-target": { default: "24px", "@media (pointer: coarse)": button.heightLg },
    "--_btn-hit-inset": "calc(max(0px, var(--_btn-target) - var(--_btn-height)) / 2)",
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    flexShrink: 0,
    height: "var(--_btn-height)",
    minWidth: "var(--_btn-target)",
    marginBlock: "var(--_btn-hit-inset)",
    paddingBlock: 0,
    borderRadius: "var(--_btn-radius)",
    borderStyle: "none",
    backgroundColor: "transparent",
    backgroundImage: {
      default: "none",
      ":hover:not([aria-disabled='true']):not(:disabled)": role.layerHover,
      ":active:not([aria-disabled='true']):not(:disabled)": role.layerPressed,
    },
    fontWeight: 500,
    cursor: {
      default: appearance.cursorInteractive,
      ":disabled": "default",
      '[aria-disabled="true"]': "default",
    },
    whiteSpace: "nowrap",
    userSelect: "none",
    textDecoration: "none",
    color: {
      default: role.contentSecondary,
      ":hover:not([aria-disabled='true']):not(:disabled)": role.contentPrimary,
      ":active:not([aria-disabled='true']):not(:disabled)": role.contentPrimary,
      "[data-pressed]:not([data-disabled])": role.contentPrimary,
      '[aria-pressed="true"]:not([aria-disabled="true"]):not(:disabled)': role.contentPrimary,
      '[aria-expanded="true"]:not([aria-disabled="true"]):not(:disabled)': role.contentPrimary,
      ":disabled": role.contentDisabled,
      "[data-disabled]": role.contentDisabled,
      '[aria-disabled="true"]:not([aria-busy="true"])': role.contentDisabled,
    },
    touchAction: "manipulation",
    transitionProperty: "background-color, color, opacity",
    transitionDuration: motion.durationFast,
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
  round: { borderRadius: shape.pill },
  joined: {
    "--_btn-hit-inset": "0px",
    height: "max(var(--_btn-height), var(--_btn-target))",
    borderStartStartRadius: { default: 0, ":first-of-type": "var(--_btn-radius)" },
    borderEndStartRadius: { default: 0, ":first-of-type": "var(--_btn-radius)" },
    borderStartEndRadius: { default: 0, ":last-of-type": "var(--_btn-radius)" },
    borderEndEndRadius: { default: 0, ":last-of-type": "var(--_btn-radius)" },
    "::after": {
      content: { default: '""', ":first-of-type": "none" },
      position: "absolute",
      insetBlock: 4,
      insetInlineStart: 0,
      width: 1,
      backgroundColor: role.borderPrimary,
      pointerEvents: "none",
    },
  },
  joinedIcon: { width: "max(var(--_btn-height), var(--_btn-target))" },
});

const group = create({
  base: { display: "inline-flex", alignItems: "center", gap: 0, minWidth: 0, flexWrap: "wrap" },
});
const ButtonGroupContext = createContext(false);
const buttonSizes = create({
  "2xs": {
    "--_btn-radius": button.radius2xs,
    "--_btn-height": button.height2xs,
    paddingInline: button.paddingInline2xs,
    gap: button.gap2xs,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  xs: {
    "--_btn-radius": button.radiusXs,
    "--_btn-height": button.heightXs,
    paddingInline: button.paddingInlineXs,
    gap: button.gapXs,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  sm: {
    "--_btn-radius": button.radiusSm,
    "--_btn-height": button.heightSm,
    paddingInline: button.paddingInlineSm,
    gap: button.gapSm,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  md: {
    "--_btn-radius": button.radiusMd,
    "--_btn-height": button.heightMd,
    paddingInline: button.paddingInlineMd,
    gap: button.gapMd,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  lg: {
    "--_btn-radius": button.radiusLg,
    "--_btn-height": button.heightLg,
    paddingInline: button.paddingInlineLg,
    gap: button.gapLg,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  xl: {
    "--_btn-radius": button.radiusXl,
    "--_btn-height": button.heightXl,
    paddingInline: button.paddingInlineXl,
    gap: button.gapXl,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
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

const buttonVariants = create({
  ghost: {
    backgroundColor: {
      default: "transparent",
      "[data-pressed]": role.bgInteractiveSecondaryTranslucent,
      '[aria-expanded="true"]': role.bgInteractiveSecondaryTranslucent,
    },
  },
  outline: {
    backgroundColor: role.bgElevated,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimary}, ${shadow.shadowSm}`,
  },
  solid: {
    color: {
      default: role.contentOnInteractiveStrong,
      ":hover:not([aria-disabled='true']):not(:disabled)": role.contentOnInteractiveStrong,
      ":active:not([aria-disabled='true']):not(:disabled)": role.contentOnInteractiveStrong,
      "[data-pressed]:not([data-disabled])": role.contentOnInteractiveStrong,
      '[aria-pressed="true"]:not([aria-disabled="true"]):not(:disabled)':
        role.contentOnInteractiveStrong,
      '[aria-expanded="true"]:not([aria-disabled="true"]):not(:disabled)':
        role.contentOnInteractiveStrong,
      ":disabled": role.contentDisabled,
      "[data-disabled]": role.contentDisabled,
      '[aria-disabled="true"]:not([aria-busy="true"])': role.contentDisabled,
    },
    backgroundColor: {
      default: role.buttonFill,
      ":hover:not([aria-disabled='true']):not(:disabled)": role.buttonFillHover,
      ":active:not([aria-disabled='true']):not(:disabled)": role.buttonFillPressed,
    },
    backgroundImage: "none",
  },
  plain: {
    fontWeight: 400,
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
      ":hover:not([aria-disabled='true']):not(:disabled)": "underline",
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
  reason: { fontWeight: 400, fontSize: type.fontSm },
  joinedReason: { order: 1, flexBasis: "100%" },
  glyphPressed: { backgroundColor: "transparent" },
});

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonTone = "neutral" | keyof typeof intent;
export type ButtonSize = keyof typeof buttonSizes;

export type ButtonSizing = { readonly size?: ButtonSize } & (
  | { readonly iconOnly?: false; readonly children: ReactNode; readonly "aria-label"?: never }
  | { readonly iconOnly: true; readonly children?: ReactNode; readonly "aria-label": string }
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

export type ButtonElementProps = Omit<
  JSX.IntrinsicElements["button"],
  "className" | "style" | "children" | "aria-label"
>;

export interface ButtonAppearance {
  readonly round?: boolean;
  readonly icon?: IconName;
  readonly tone?: ButtonTone;
  readonly xstyle?: ButtonLayout;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export type ButtonProps = ButtonElementProps &
  ButtonSizing &
  ButtonAppearance & {
    readonly variant?: ButtonVariant;
    readonly loading?: boolean;
    readonly disabledReason?: string;
  };

export type ButtonLinkProps = Omit<
  JSX.IntrinsicElements["a"],
  "className" | "style" | "children" | "aria-label" | "href"
> &
  ButtonSizing &
  ButtonAppearance & { readonly href: string; readonly variant?: ButtonVariant };

const glyphSizes = {
  text: { "2xs": 12, xs: 12, sm: 14, md: 14, lg: 14, xl: 16 },
  iconOnly: { "2xs": 12, xs: 12, sm: 14, md: 16, lg: 16, xl: 18 },
} as const satisfies Record<string, Record<ButtonSize, number>>;

export function buttonGlyphSize(size: ButtonSize, iconOnly: boolean): number {
  return glyphSizes[iconOnly ? "iconOnly" : "text"][size];
}

export function buttonStyle(
  variant: ButtonVariant,
  size: ButtonSize,
  {
    iconOnly = false,
    round = false,
    joined = false,
    tone = variant === "text" ? "primary" : "neutral",
    xstyle,
    className,
    style,
  }: ButtonAppearance & { readonly iconOnly?: boolean; readonly joined?: boolean },
  glyphPressed = false,
) {
  return mergeStyleProps(
    props(
      tone !== "neutral" && intent[tone],
      control.base,
      buttonSizes[size],
      round && pillSizes[size],
      iconOnly && control.iconOnly,
      buttonVariants[variant],
      round && control.round,
      joined && control.joined,
      joined && iconOnly && control.joinedIcon,
      size === "2xs" ? focus.ringInset : focus.ring,
      xstyle,
      glyphPressed && contentStyles.glyphPressed,
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
  round,
  icon,
  tone,
  xstyle,
  className,
  style,
  children,
  type = "button",
  disabled,
  disabledReason,
  loading = false,
  onClick,
  onKeyDown,
  ...rest
}: ButtonProps): ReactElement {
  const joined = use(ButtonGroupContext);
  const reasonId = useId();
  const showReason = disabled && disabledReason !== undefined;
  const unavailable = loading || disabled;

  return (
    <>
      <button
        title={tooltipTitle(iconOnly, rest["aria-label"])}
        {...rest}
        type={type}
        disabled={disabled && !showReason && !loading}
        aria-disabled={unavailable || undefined}
        aria-busy={loading || undefined}
        aria-describedby={
          showReason
            ? [rest["aria-describedby"], reasonId].filter(Boolean).join(" ")
            : rest["aria-describedby"]
        }
        data-disabled={disabled ? "" : undefined}
        onClick={(event) => {
          if (unavailable) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClick?.(event);
        }}
        onKeyDown={(event) => {
          if (unavailable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onKeyDown?.(event);
        }}
        {...buttonStyle(variant, size, { iconOnly, round, joined, tone, xstyle, className, style })}
      >
        <ButtonContent icon={icon} size={size} iconOnly={iconOnly} loading={loading}>
          {children}
        </ButtonContent>
      </button>
      {showReason && (
        <span id={reasonId} {...props(contentStyles.reason, joined && contentStyles.joinedReason)}>
          {disabledReason}
        </span>
      )}
    </>
  );
}

export function ButtonLink({
  variant = "ghost",
  size = "md",
  iconOnly = false,
  round,
  icon,
  tone,
  xstyle,
  className,
  style,
  children,
  ...rest
}: ButtonLinkProps): ReactElement {
  const joined = use(ButtonGroupContext);
  return (
    <a
      title={tooltipTitle(iconOnly, rest["aria-label"])}
      {...rest}
      {...buttonStyle(variant, size, { iconOnly, round, joined, tone, xstyle, className, style })}
    >
      <ButtonContent icon={icon} size={size} iconOnly={iconOnly}>
        {children}
      </ButtonContent>
    </a>
  );
}

export type ButtonGroupProps = StyledProps<JSX.IntrinsicElements["div"]>;

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

export type SplitButtonMenuTriggerProps = Omit<
  ButtonProps,
  "iconOnly" | "children" | "aria-label" | "aria-haspopup"
> & { readonly "aria-label": string };

function SplitButtonMenuTrigger({
  icon = "chevron-down",
  ...rest
}: SplitButtonMenuTriggerProps): ReactElement {
  return <Button {...rest} icon={icon} iconOnly aria-haspopup="menu" />;
}

export const SplitButton = { Root: ButtonGroup, Main: Button, MenuTrigger: SplitButtonMenuTrigger };
