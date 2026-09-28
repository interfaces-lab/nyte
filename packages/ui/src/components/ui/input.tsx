/**
 * Text fields. `raised` sits on panels and in the workbench, `quiet` on the
 * Settings surface. An `InputGroup` draws the same frame around an `Input`
 * and whatever glyphs or controls sit beside it; the input inside turns bare.
 */
import { Input as InputPrimitive } from "@base-ui/react/input";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, type JSX, type ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";

const field = create({
  base: {
    boxSizing: "border-box",
    minWidth: 0,
    margin: 0,
    color: t.textPrimary,
    fontFamily: "inherit",
    "::placeholder": { color: t.textTertiary },
  },
  framed: {
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: t.radiusBase,
    outlineStyle: "none",
  },
  bare: {
    padding: 0,
    appearance: "none",
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  grouped: { flex: 1 },
});

const variants = create({
  raised: {
    paddingInline: 6,
    borderColor: {
      default: t.strokeSecondary,
      ":focus": t.strokeFocused,
      "[aria-invalid=true]": t.red,
    },
    backgroundColor: t.bgRaised,
  },
  quiet: {
    paddingInline: 8,
    borderColor: {
      default: t.strokeSecondary,
      ":focus": t.strokePrimary,
      "[aria-invalid=true]": t.red,
    },
    backgroundColor: t.fillQuiet,
  },
});

const groupVariants = create({
  raised: {
    gap: 4,
    paddingInline: 6,
    borderColor: { default: t.strokeSecondary, ":focus-within": t.strokeFocused },
    backgroundColor: t.bgRaised,
  },
  quiet: {
    gap: 8,
    paddingInline: 8,
    borderColor: { default: t.strokeSecondary, ":focus-within": t.strokePrimary },
    backgroundColor: t.fillQuiet,
  },
});

const group = create({
  base: {
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    minWidth: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: t.radiusBase,
    color: t.iconTertiary,
  },
});

const type = create({
  sm: { fontSize: t.fontSm, lineHeight: t.leadingSm },
  default: { fontSize: t.fontBase, lineHeight: t.leadingBase, letterSpacing: t.letterBase },
  lg: { fontSize: t.fontLg, lineHeight: t.leadingLg, letterSpacing: t.letterLg },
});

const heights = create({
  sm: { height: 24 },
  default: { height: 28 },
  lg: { height: 36 },
});

const textarea = create({
  base: { display: "block", minHeight: 64, resize: "vertical" },
  raised: { paddingBlock: 4 },
  quiet: { paddingBlock: 6 },
});

export type InputVariant = keyof typeof variants | "bare";

export type InputGroupVariant = keyof typeof groupVariants;

export type InputSize = keyof typeof type;

const InputGroupContext = createContext<InputSize | undefined>(undefined);

export type InputProps = StyledProps<Omit<InputPrimitive.Props, "size">> & {
  /** Defaults to `raised`, or to `bare` inside an `InputGroup`. */
  readonly variant?: InputVariant;
  /** Defaults to `default`, or to the size of the enclosing `InputGroup`. */
  readonly size?: InputSize;
};

export function Input({
  variant,
  size,
  xstyle,
  className,
  style,
  ...rest
}: InputProps): ReactElement {
  const groupSize = use(InputGroupContext);
  const resolvedVariant = variant ?? (groupSize === undefined ? "raised" : "bare");
  const resolvedSize = size ?? groupSize ?? "default";

  return (
    <InputPrimitive
      data-slot="input"
      {...rest}
      {...mergeStyleProps(
        props(
          field.base,
          resolvedVariant === "bare" ? field.bare : [field.framed, variants[resolvedVariant]],
          groupSize !== undefined && field.grouped,
          type[resolvedSize],
          resolvedVariant !== "bare" && heights[resolvedSize],
          xstyle,
        ),
        className,
        style,
      )}
    />
  );
}

export type InputGroupProps = StyledProps<JSX.IntrinsicElements["label"]> & {
  readonly variant?: InputGroupVariant;
  readonly size?: InputSize;
};

/** A framed `<label>` that makes the `Input` inside it bare, beside its glyphs and controls. */
export function InputGroup({
  variant = "raised",
  size = "default",
  xstyle,
  className,
  style,
  children,
  ...rest
}: InputGroupProps): ReactElement {
  return (
    <label
      data-slot="input-group"
      {...rest}
      {...mergeStyleProps(
        props(group.base, groupVariants[variant], heights[size], xstyle),
        className,
        style,
      )}
    >
      <InputGroupContext value={size}>{children}</InputGroupContext>
    </label>
  );
}

export type TextareaProps = StyledProps<JSX.IntrinsicElements["textarea"]> & {
  readonly variant?: InputGroupVariant;
  readonly size?: InputSize;
};

export function Textarea({
  variant = "raised",
  size = "default",
  xstyle,
  className,
  style,
  ...rest
}: TextareaProps): ReactElement {
  return (
    <textarea
      data-slot="textarea"
      {...rest}
      {...mergeStyleProps(
        props(
          field.base,
          field.framed,
          variants[variant],
          type[size],
          textarea.base,
          textarea[variant],
          xstyle,
        ),
        className,
        style,
      )}
    />
  );
}
