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
    display: "block",
    width: "100%",
    minHeight: controlVars["--nyte-control-textarea-min-height"],
    paddingInline: controlVars["--nyte-control-padding-lg"],
    paddingBlock: controlVars["--nyte-control-padding-sm"],
    resize: "vertical",
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

export interface TextareaProps extends Omit<
  React.ComponentProps<"textarea">,
  "className" | "style"
> {
  className?: string;
  style?: React.CSSProperties;
  unstyled?: boolean;
  xstyle?: XStyle;
}

export function Textarea({ className, style, unstyled = false, xstyle, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      {...mergeStyleProps(stylex.props(!unstyled && styles.root, xstyle), className, style)}
      {...props}
    />
  );
}
