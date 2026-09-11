import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
} from "../../platform-tokens.stylex.ts";
import { mergeStyleProps, type XStyle } from "../../style.ts";

const styles = stylex.create({
  root: {
    appearance: "none",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    gap: controlVars["--nyte-control-gap-sm"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radiusVars["--nyte-radius-control"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontWeight: fontVars["--nyte-font-weight-medium"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    textDecoration: "none",
    userSelect: "none",
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
    opacity: {
      default: 1,
      ":disabled": controlVars["--nyte-control-disabled-opacity"],
      "[data-disabled]": controlVars["--nyte-control-disabled-opacity"],
    },
    pointerEvents: { default: "auto", ":disabled": "none", "[data-disabled]": "none" },
    transform: { default: "none", ":active:not(:disabled)": "translateY(1px)" },
    transitionProperty: "background-color, border-color, color, opacity",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  default: {
    backgroundColor: {
      default: colorVars["--nyte-color-primary"],
      ":hover": { "@media (hover: hover)": colorVars["--nyte-color-primary-hover"] },
      "[data-popup-open]": colorVars["--nyte-color-primary-hover"],
    },
    color: colorVars["--nyte-color-primary-foreground"],
  },
  outline: {
    borderColor: {
      default: colorVars["--nyte-color-border"],
      ":hover": { "@media (hover: hover)": colorVars["--nyte-color-border-strong"] },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--nyte-color-muted"] },
      "[data-popup-open]": colorVars["--nyte-color-muted"],
    },
    color: colorVars["--nyte-color-foreground"],
  },
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--nyte-color-muted-hover"] },
      "[data-popup-open]": colorVars["--nyte-color-muted-hover"],
    },
    color: colorVars["--nyte-color-foreground"],
  },
  destructive: {
    backgroundColor: {
      default: colorVars["--nyte-color-destructive-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--nyte-color-destructive-hover"] },
      "[data-popup-open]": colorVars["--nyte-color-destructive-hover"],
    },
    color: colorVars["--nyte-color-destructive"],
  },
  defaultSize: {
    height: controlVars["--nyte-control-height-md"],
    paddingInline: controlVars["--nyte-control-padding-sm"],
    fontSize: fontVars["--nyte-font-size-body"],
  },
  sm: {
    height: controlVars["--nyte-control-height-sm"],
    paddingInline: controlVars["--nyte-control-padding-xs"],
    gap: controlVars["--nyte-control-gap-sm"],
    fontSize: fontVars["--nyte-font-size-detail"],
  },
  iconSm: {
    width: controlVars["--nyte-control-height-sm"],
    height: controlVars["--nyte-control-height-sm"],
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
