import { Input as InputPrimitive } from "@base-ui/react/input";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import { tokens } from "../../platform-tokens.stylex.ts";
import { mergeStyleProps, type XStyle } from "../../style.ts";

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    minHeight: tokens.control["--nyte-control-height-md"],
    paddingInline: tokens.control["--nyte-control-padding-lg"],
    paddingBlock: tokens.control["--nyte-control-padding-sm"],
    borderWidth: tokens.border["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: {
      default: tokens.color["--nyte-color-border"],
      ":focus-visible": tokens.color["--nyte-color-ring"],
      "[aria-invalid=true]": tokens.color["--nyte-color-destructive"],
    },
    borderRadius: tokens.radius["--nyte-radius-field"],
    backgroundColor: tokens.color["--nyte-color-field-background"],
    boxShadow: {
      default: "none",
      ":focus-visible": `0 0 0 2px ${tokens.color["--nyte-color-ring"]}`,
    },
    color: tokens.color["--nyte-color-foreground"],
    fontFamily: tokens.font["--nyte-font-family-ui"],
    fontSize: tokens.font["--nyte-font-size-body"],
    fontWeight: tokens.font["--nyte-font-weight-regular"],
    lineHeight: tokens.font["--nyte-leading-body"],
    outlineStyle: "none",
    opacity: { default: 1, ":disabled": tokens.control["--nyte-control-disabled-opacity"] },
    transitionProperty: "background-color, border-color, outline-color, opacity",
    transitionDuration: {
      default: tokens.motion["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    "::placeholder": { color: tokens.color["--nyte-color-muted-foreground"] },
  },
});

export interface InputProps extends Omit<InputPrimitive.Props, "className" | "style"> {
  className?: string;
  style?: React.CSSProperties;
  unstyled?: boolean;
  xstyle?: XStyle;
}

export function Input({ className, style, unstyled = false, xstyle, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      {...mergeStyleProps(stylex.props(!unstyled && styles.root, xstyle), className, style)}
      {...props}
    />
  );
}
