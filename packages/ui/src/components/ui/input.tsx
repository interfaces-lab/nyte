import { Input as InputPrimitive } from "@base-ui/react/input";
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
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    minHeight: controlVars["--nyte-control-height-md"],
    paddingInline: controlVars["--nyte-control-padding-lg"],
    paddingBlock: controlVars["--nyte-control-padding-sm"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: {
      default: colorVars["--nyte-color-border"],
      ":focus-visible": colorVars["--nyte-color-ring"],
      "[aria-invalid=true]": colorVars["--nyte-color-destructive"],
    },
    borderRadius: radiusVars["--nyte-radius-field"],
    backgroundColor: colorVars["--nyte-color-field-background"],
    boxShadow: {
      default: "none",
      ":focus-visible": `0 0 0 2px ${colorVars["--nyte-color-focus-ring"]}`,
    },
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-body"],
    fontWeight: fontVars["--nyte-font-weight-regular"],
    lineHeight: fontVars["--nyte-leading-body"],
    outlineStyle: "none",
    opacity: { default: 1, ":disabled": controlVars["--nyte-control-disabled-opacity"] },
    transitionProperty: "background-color, border-color, outline-color, opacity",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    "::placeholder": { color: colorVars["--nyte-color-muted-foreground"] },
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
