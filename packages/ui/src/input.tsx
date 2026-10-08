/**
 * Text fields. `raised` sits on panels and in the workbench, `quiet` on the
 * Settings surface. An `InputGroup` draws the same frame around an `Input`
 * and whatever glyphs or controls sit beside it; the input inside turns bare.
 */
import { Input as InputPrimitive } from "@base-ui/react/input";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, type ComponentProps, type ReactElement } from "react";

import { input, target } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { intent } from "./surface-theme.ts";
import { danger } from "./theme.stylex.ts";
import { appearance, role, type } from "./vars.stylex.ts";

const field = create({
  base: {
    boxSizing: "border-box",
    minWidth: 0,
    margin: 0,
    color: role.contentPrimary,
    fontFamily: "inherit",
    fontSize: {
      default: type.fontBase,
      "@media (pointer: coarse)": `max(16px, ${type.fontBase})`,
    },
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    "::placeholder": { color: role.contentSecondary },
  },
  framed: {
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: "var(--_input-radius)",
    outlineStyle: "none",
  },
  bare: {
    padding: 0,
    minHeight: target.min,
    appearance: "none",
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  grouped: { flex: 1, alignSelf: "stretch", height: "100%", minHeight: 0 },
});

const variants = create({
  raised: {
    borderColor: {
      default: role.borderPrimaryTranslucent,
      ":focus": appearance.focusColor,
      ":user-invalid": danger.border,
      "[aria-invalid=true]": role.borderInteractivePrimary,
    },
    backgroundColor: role.bgElevated,
  },
  quiet: {
    borderColor: {
      default: role.borderSecondaryTranslucent,
      ":focus": appearance.focusColor,
      ":user-invalid": danger.border,
      "[aria-invalid=true]": role.borderInteractivePrimary,
    },
    backgroundColor: role.bgMutedTranslucent,
  },
});

const groupVariants = create({
  raised: {
    borderColor: {
      default: role.borderPrimaryTranslucent,
      ":focus-within": appearance.focusColor,
    },
    backgroundColor: role.bgElevated,
  },
  quiet: {
    borderColor: {
      default: role.borderSecondaryTranslucent,
      ":focus-within": appearance.focusColor,
    },
    backgroundColor: role.bgMutedTranslucent,
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
    color: role.contentTertiary,
  },
});

/** Input sizes grow under a coarse pointer. */
const sizes = create({
  md: {
    "--_input-radius": input.radiusMd,
    "--_input-inset": input.insetMd,
    "--_input-padding-end": input.paddingEndMd,
    "--_input-textarea-min-height": input.textareaMinHeightMd,
    "--_input-textarea-padding-block": input.textareaPaddingBlockMd,
    minHeight: target.min,
    height: input.heightMd,
  },
  lg: {
    "--_input-radius": input.radiusLg,
    "--_input-inset": input.insetLg,
    "--_input-padding-end": input.paddingEndLg,
    "--_input-textarea-min-height": input.textareaMinHeightLg,
    "--_input-textarea-padding-block": input.textareaPaddingBlockLg,
    minHeight: target.min,
    height: input.heightLg,
  },
  xl: {
    "--_input-radius": input.radiusXl,
    "--_input-inset": input.insetXl,
    "--_input-padding-end": input.paddingEndXl,
    "--_input-textarea-min-height": input.textareaMinHeightXl,
    "--_input-textarea-padding-block": input.textareaPaddingBlockXl,
    minHeight: target.min,
    height: input.heightXl,
  },
});

/** A framed field clears its text by the inset plus the control's own start padding. */
const framedPadding = create({
  base: {
    paddingInlineStart: "calc(var(--_input-inset) + 4px)",
    paddingInlineEnd: "var(--_input-padding-end)",
  },
});

const textarea = create({
  base: {
    display: "block",
    fieldSizing: "content",
    height: "auto",
    minHeight: "var(--_input-textarea-min-height)",
    maxHeight: "12lh",
    paddingBlock: "var(--_input-textarea-padding-block)",
    paddingInline: "calc(var(--_input-inset) + 4px) var(--_input-inset)",
    resize: "vertical",
  },
});

const InputGroupContext = createContext<keyof typeof sizes | undefined>(undefined);

export function Input({
  variant,
  size,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Omit<InputPrimitive.Props, "size">> & {
  /** Defaults to `raised`, or to `bare` inside an `InputGroup`. */
  readonly variant?: keyof typeof variants | "bare";
  /** Defaults to `md`, or to the size of the enclosing `InputGroup`. */
  readonly size?: keyof typeof sizes;
}): ReactElement {
  const groupSize = use(InputGroupContext);
  const resolvedVariant = variant ?? (groupSize === undefined ? "raised" : "bare");
  const resolvedSize = size ?? groupSize ?? "md";

  return (
    <InputPrimitive
      data-slot="input"
      {...rest}
      {...mergeStyleProps(
        (state: InputPrimitive.State) =>
          props(
            field.base,
            (state.valid === false || (rest["aria-invalid"] && rest["aria-invalid"] !== "false")) &&
              intent.danger,
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

/** A framed `<label>` that makes the `Input` inside it bare, beside its glyphs and controls. */
export function InputGroup({
  variant = "raised",
  size = "md",
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<ComponentProps<"label">> & {
  readonly variant?: keyof typeof groupVariants;
  readonly size?: keyof typeof sizes;
}): ReactElement {
  return (
    <label
      data-slot="input-group"
      {...rest}
      {...mergeStyleProps(
        props(
          rest["aria-invalid"] && rest["aria-invalid"] !== "false" && intent.danger,
          group.base,
          groupVariants[variant],
          sizes[size],
          xstyle,
        ),
        className,
        style,
      )}
    >
      <InputGroupContext value={size}>{children}</InputGroupContext>
    </label>
  );
}

export function Textarea({
  variant = "raised",
  size = "md",
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ComponentProps<"textarea">> & {
  readonly variant?: keyof typeof groupVariants;
  readonly size?: keyof typeof sizes;
}): ReactElement {
  return (
    <textarea
      data-slot="textarea"
      {...rest}
      {...mergeStyleProps(
        props(
          rest["aria-invalid"] && rest["aria-invalid"] !== "false" && intent.danger,
          field.base,
          field.framed,
          variants[variant],
          sizes[size],
          textarea.base,
          xstyle,
        ),
        className,
        style,
      )}
    />
  );
}
