import type { CSSProperties } from "react";
import type { CompiledStyles, InlineStyles, StyleXArray, props } from "@stylexjs/stylex";

export { cn } from "cn";

export type XStyle = StyleXArray<
  null | undefined | boolean | CompiledStyles | readonly [CompiledStyles, InlineStyles]
>;

type Compiled = {
  readonly className?: string;
  readonly style?: ReturnType<typeof props>["style"] | CSSProperties;
};

type ClassName<State> = string | ((state: State) => string | undefined);

type Style<State> = CSSProperties | ((state: State) => CSSProperties | undefined);

export type StaticStyleProps = { readonly className?: string; readonly style?: CSSProperties };

/**
 * A wrapper's props: the part's own `className` and `style`, which Base UI parts
 * also accept as functions of their state, plus StyleX styles in `xstyle`.
 */
export type StyledProps<Props> = Omit<Props, "className" | "style" | "xstyle"> & {
  className?: "className" extends keyof Props ? Props["className"] : string;
  style?: "style" extends keyof Props ? Props["style"] : CSSProperties;
  xstyle?: XStyle;
};

/** `className` and `style` for a part whose state is `State`. */
export type StateStyledProps<State> = {
  readonly className?: ClassName<State>;
  readonly style?: Style<State>;
};

function resolve<State, Value>(value: Value | ((state: State) => Value), state: State): Value {
  return value instanceof Function ? value(state) : value;
}

/**
 * Lays the part's own `className` and `style` over compiled StyleX styles. Given a
 * function anywhere, it returns functions of the part's state, as Base UI expects.
 */
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
  if (base instanceof Function || className instanceof Function || style instanceof Function) {
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
