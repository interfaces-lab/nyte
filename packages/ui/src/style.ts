import type { CSSProperties, HTMLAttributes } from "react";
import type { CompiledStyles, InlineStyles, StyleXArray, props } from "@stylexjs/stylex";

export { cn } from "cn";

export type XStyle = StyleXArray<
  null | undefined | boolean | CompiledStyles | readonly [CompiledStyles, InlineStyles]
>;

export type StyledProps<Props> = Omit<Props, "className" | "style"> & {
  className?: string;
  style?: CSSProperties;
  xstyle?: XStyle;
};

export function mergeStyleProps(
  base: ReturnType<typeof props>,
  className?: string,
  style?: CSSProperties,
): Pick<HTMLAttributes<HTMLElement>, "className" | "style"> {
  return {
    className: [base.className, className].filter(Boolean).join(" ") || undefined,
    style: { ...base.style, ...style },
  };
}
