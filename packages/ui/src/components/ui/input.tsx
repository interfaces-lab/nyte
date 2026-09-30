/**
 * Text fields. `raised` sits on panels and in the workbench, `quiet` on the
 * Settings surface. An `InputGroup` draws the same frame around an `Input`
 * and whatever glyphs or controls sit beside it; the input inside turns bare.
 */
import { Input as InputPrimitive } from "@base-ui/react/input";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, type JSX, type ReactElement } from "react";

import { input } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { ramp, t } from "../../vars.stylex.ts";

const field = create({
  base: {
    boxSizing: "border-box",
    minWidth: 0,
    margin: 0,
    color: t.contentPrimary,
    fontFamily: "inherit",
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    "::placeholder": { color: t.contentTertiary },
  },
  framed: {
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: "var(--_input-radius)",
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
    borderColor: {
      default: t.borderPrimaryTranslucent,
      ":focus": ramp.blue80,
      "[aria-invalid=true]": ramp.red80,
    },
    backgroundColor: t.bgElevated,
  },
  quiet: {
    borderColor: {
      default: t.borderSecondaryTranslucent,
      ":focus": t.borderPrimaryTranslucent,
      "[aria-invalid=true]": ramp.red80,
    },
    backgroundColor: t.bgMutedTranslucent,
  },
});

const groupVariants = create({
  raised: {
    borderColor: { default: t.borderPrimaryTranslucent, ":focus-within": ramp.blue80 },
    backgroundColor: t.bgElevated,
  },
  quiet: {
    borderColor: {
      default: t.borderSecondaryTranslucent,
      ":focus-within": t.borderPrimaryTranslucent,
    },
    backgroundColor: t.bgMutedTranslucent,
  },
});

const group = create({
  base: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    boxSizing: "border-box",
    minWidth: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: "var(--_input-radius)",
    paddingInlineStart: "var(--_input-inset)",
    paddingInlineEnd: "var(--_input-padding-end)",
    color: t.contentTertiary,
  },
});

/** Notion Calendar's input sizes, which grow under a coarse pointer. */
const sizes = create({
  md: {
    "--_input-radius": input.radiusMd,
    "--_input-inset": input.insetMd,
    "--_input-padding-end": input.paddingEndMd,
    "--_input-textarea-min-height": input.textareaMinHeightMd,
    "--_input-textarea-padding-block": input.textareaPaddingBlockMd,
    height: input.heightMd,
  },
  lg: {
    "--_input-radius": input.radiusLg,
    "--_input-inset": input.insetLg,
    "--_input-padding-end": input.paddingEndLg,
    "--_input-textarea-min-height": input.textareaMinHeightLg,
    "--_input-textarea-padding-block": input.textareaPaddingBlockLg,
    height: input.heightLg,
  },
  xl: {
    "--_input-radius": input.radiusXl,
    "--_input-inset": input.insetXl,
    "--_input-padding-end": input.paddingEndXl,
    "--_input-textarea-min-height": input.textareaMinHeightXl,
    "--_input-textarea-padding-block": input.textareaPaddingBlockXl,
    height: input.heightXl,
  },
});

/** A framed field clears its text by the inset plus the control's own start padding. */
const framedPadding = create({
  base: {
    paddingInlineStart: "calc(var(--_input-inset) + var(--nyte-spacing-4))",
    paddingInlineEnd: "var(--_input-padding-end)",
  },
});

const textarea = create({
  base: {
    display: "block",
    height: "auto",
    minHeight: "var(--_input-textarea-min-height)",
    paddingBlock: "var(--_input-textarea-padding-block)",
    paddingInline: "calc(var(--_input-inset) + var(--nyte-spacing-4)) var(--_input-inset)",
    resize: "vertical",
  },
});

export type InputVariant = keyof typeof variants | "bare";

export type InputGroupVariant = keyof typeof groupVariants;

export type InputSize = keyof typeof sizes;

const InputGroupContext = createContext<InputSize | undefined>(undefined);

export type InputProps = StyledProps<Omit<InputPrimitive.Props, "size">> & {
  /** Defaults to `raised`, or to `bare` inside an `InputGroup`. */
  readonly variant?: InputVariant;
  /** Defaults to `md`, or to the size of the enclosing `InputGroup`. */
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
  const resolvedSize = size ?? groupSize ?? "md";

  return (
    <InputPrimitive
      data-slot="input"
      {...rest}
      {...mergeStyleProps(
        props(
          field.base,
          resolvedVariant === "bare"
            ? field.bare
            : [field.framed, variants[resolvedVariant], sizes[resolvedSize], framedPadding.base],
          groupSize !== undefined && field.grouped,
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
  size = "md",
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
        props(group.base, groupVariants[variant], sizes[size], xstyle),
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
  size = "md",
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
        props(field.base, field.framed, variants[variant], sizes[size], textarea.base, xstyle),
        className,
        style,
      )}
    />
  );
}
