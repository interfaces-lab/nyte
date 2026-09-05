import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import { tokens } from "../../platform-tokens.stylex.ts";
import { mergeStyleProps, type XStyle } from "../../style.ts";

const styles = stylex.create({
  root: {
    appearance: "none",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    gap: tokens.control["--nyte-control-gap-sm"],
    borderWidth: tokens.border["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: tokens.radius["--nyte-radius-control"],
    fontFamily: tokens.font["--nyte-font-family-ui"],
    fontWeight: tokens.font["--nyte-font-weight-medium"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    textDecoration: "none",
    userSelect: "none",
    outlineColor: tokens.color["--nyte-color-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: tokens.control["--nyte-control-focus-width"],
    outlineOffset: tokens.control["--nyte-control-focus-offset"],
    opacity: {
      default: 1,
      ":disabled": tokens.control["--nyte-control-disabled-opacity"],
      "[data-disabled]": tokens.control["--nyte-control-disabled-opacity"],
    },
    pointerEvents: { default: "auto", ":disabled": "none", "[data-disabled]": "none" },
    transform: { default: "none", ":active:not(:disabled)": "translateY(1px)" },
    transitionProperty: "background-color, border-color, color, opacity",
    transitionDuration: {
      default: tokens.motion["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: tokens.motion["--nyte-motion-ease-out"],
  },
  default: {
    backgroundColor: {
      default: tokens.color["--nyte-color-primary"],
      ":hover": { "@media (hover: hover)": tokens.color["--nyte-color-primary-hover"] },
      "[data-popup-open]": tokens.color["--nyte-color-primary-hover"],
    },
    color: tokens.color["--nyte-color-primary-foreground"],
  },
  outline: {
    borderColor: {
      default: tokens.color["--nyte-color-border"],
      ":hover": { "@media (hover: hover)": tokens.color["--nyte-color-border-strong"] },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": tokens.color["--nyte-color-muted"] },
      "[data-popup-open]": tokens.color["--nyte-color-muted"],
    },
    color: tokens.color["--nyte-color-foreground"],
  },
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": tokens.color["--nyte-color-muted-hover"] },
      "[data-popup-open]": tokens.color["--nyte-color-muted-hover"],
    },
    color: tokens.color["--nyte-color-foreground"],
  },
  destructive: {
    backgroundColor: {
      default: tokens.color["--nyte-color-destructive-muted"],
      ":hover": { "@media (hover: hover)": tokens.color["--nyte-color-destructive-hover"] },
      "[data-popup-open]": tokens.color["--nyte-color-destructive-hover"],
    },
    color: tokens.color["--nyte-color-destructive"],
  },
  defaultSize: {
    height: tokens.control["--nyte-control-height-md"],
    paddingInline: tokens.control["--nyte-control-padding-sm"],
    fontSize: tokens.font["--nyte-font-size-body"],
  },
  sm: {
    height: tokens.control["--nyte-control-height-sm"],
    paddingInline: tokens.control["--nyte-control-padding-xs"],
    gap: tokens.control["--nyte-control-gap-sm"],
    fontSize: tokens.font["--nyte-font-size-detail"],
  },
  iconSm: {
    width: tokens.control["--nyte-control-height-sm"],
    height: tokens.control["--nyte-control-height-sm"],
    paddingInline: 0,
  },
});

const variantStyles = {
  default: styles.default,
  outline: styles.outline,
  ghost: styles.ghost,
  destructive: styles.destructive,
} as const;

const sizeStyles = {
  default: styles.defaultSize,
  sm: styles.sm,
  "icon-sm": styles.iconSm,
} as const;

export type ButtonVariant = keyof typeof variantStyles;
export type ButtonSize = keyof typeof sizeStyles;

interface StyledButtonAppearance {
  size?: ButtonSize;
  unstyled?: false;
  variant?: ButtonVariant;
}

interface UnstyledButtonAppearance {
  size?: never;
  unstyled: true;
  variant?: never;
}

export type ButtonProps = Omit<ButtonPrimitive.Props, "className" | "style"> & {
  className?: string;
  style?: React.CSSProperties;
  xstyle?: XStyle;
} & (StyledButtonAppearance | UnstyledButtonAppearance);

export function Button({
  className,
  render,
  size = "default",
  style,
  type,
  unstyled = false,
  variant = "default",
  xstyle,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-size={unstyled ? undefined : size}
      data-variant={unstyled ? undefined : variant}
      render={render}
      type={type ?? (render ? undefined : "button")}
      {...mergeStyleProps(
        stylex.props(
          !unstyled && styles.root,
          !unstyled && variantStyles[variant],
          !unstyled && sizeStyles[size],
          xstyle,
        ),
        className,
        style,
      )}
      {...props}
    />
  );
}
