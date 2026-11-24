import type { CSSProperties } from "react";
import type { CompiledStyles, InlineStyles, StyleXArray, props } from "@stylexjs/stylex";

export { cn } from "cn";

export type XStyle = StyleXArray<
  null | undefined | boolean | CompiledStyles | readonly [CompiledStyles, InlineStyles]
>;

interface Compiled {
  readonly className?: string;
  readonly style?: ReturnType<typeof props>["style"] | CSSProperties;
}

type ClassName<State> = string | ((state: State) => string | undefined);

type Style<State> = CSSProperties | ((state: State) => CSSProperties | undefined);

export interface StaticStyleProps {
  readonly className?: string;
  readonly style?: CSSProperties;
}

export type StyledProps<Props, Style extends XStyle = XStyle> = Omit<
  Props,
  "className" | "style" | "xstyle"
> & {
  className?: "className" extends keyof Props ? Props["className"] : string;
  style?: "style" extends keyof Props ? Props["style"] : CSSProperties;
  xstyle?: Style;
};

export interface StateStyledProps<State> {
  readonly className?: ClassName<State>;
  readonly style?: Style<State>;
}

function resolve<State, Value extends object | string | undefined>(
  value: Value | ((state: State) => Value),
  state: State,
): Value {
  return typeof value === "function" ? value(state) : value;
}

export function mergeStyleProps(
  base: Compiled,
  className?: string,
  style?: CSSProperties,
): StaticStyleProps;
export function mergeStyleProps<State>(
  base: Compiled | ((state: State) => Compiled),
  className?: ClassName<State>,
  style?: Style<State>,
): StateStyledProps<State>;
export function mergeStyleProps<State>(
  base: Compiled | ((state: State) => Compiled),
  className?: ClassName<State>,
  style?: Style<State>,
): StateStyledProps<State> {
  if (
    typeof base === "function" ||
    typeof className === "function" ||
    typeof style === "function"
  ) {
    const merge = (state: State) => {
      const compiled = resolve(base, state);

      return {
        className:
          [compiled.className, resolve(className, state)].filter(Boolean).join(" ") || undefined,
        style: { ...compiled.style, ...resolve(style, state) },
      };
    };

    return {
      className: (state) => merge(state).className,
      style: (state) => merge(state).style,
    };
  }

  return {
    className: [base.className, className].filter(Boolean).join(" ") || undefined,
    style: { ...base.style, ...style },
  };
}
