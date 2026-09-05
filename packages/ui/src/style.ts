import type * as React from "react";
import type * as stylex from "@stylexjs/stylex";

export type XStyle = stylex.StyleXArray<
  | null
  | undefined
  | boolean
  | stylex.CompiledStyles
  | readonly [stylex.CompiledStyles, stylex.InlineStyles]
>;

export type StyledProps<Props> = Omit<Props, "className" | "style"> & {
  className?: string;
  style?: React.CSSProperties;
  xstyle?: XStyle;
};

export function mergeStyleProps(
  base: ReturnType<typeof stylex.props>,
  className?: string,
  style?: React.CSSProperties,
) {
  return {
    className: [base.className, className].filter(Boolean).join(" ") || undefined,
    style: { ...base.style, ...style },
  };
}
