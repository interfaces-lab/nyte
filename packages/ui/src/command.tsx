/**
 * A command palette: a dialog near the top of the window holding an inline
 * Base UI Autocomplete. The dialog owns open state, the scrim, and focus; the
 * autocomplete owns the input, the highlight, and arrow-key and Enter handling.
 * `Popup` renders the portal, scrim, viewport, panel, and autocomplete root as
 * one unit, so every palette opens the same surface and navigates the same way.
 *
 * Filtering is the caller's: render the rows that match and pass their values
 * as `items`, in render order, so the highlight tracks the rows that exist.
 * Rows keep the menu's three columns, leading glyph, label, and meta, so labels
 * align in every group.
 */
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import { srOnly } from "./styles/a11y.stylex.ts";
import { floatingSurfaceStyles } from "./styles/floating-surface.stylex.ts";
import { glyph, layer, radius, space, target } from "./styles/schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, motion, role, type } from "./styles/vars.stylex.ts";
import { Icon } from "./icon.tsx";

const styles = create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: layer.commandBackdrop,
    backgroundColor: role.bgScrim,
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  },
  viewport: {
    position: "fixed",
    inset: 0,
    zIndex: layer.command,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingBlockStart: "clamp(72px, 12vh, 144px)",
    paddingBlockEnd: space.s4,
    paddingInline: space.s4,
    overflow: "clip",
  },
  popup: {
    display: "flex",
    flexDirection: "column",
    width: "min(560px, 100%)",
    maxHeight: "min(430px, 100%)",
    borderStyle: "none",
    borderRadius: `calc(${radius.card} + 8px)`,
    outline: "none",
    overflow: "clip",
    color: role.contentPrimary,
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transform: {
      default: "none",
      "[data-starting-style]": "translate3d(0, -4px, 0) scale(0.98)",
      "[data-ending-style]": "translate3d(0, -4px, 0) scale(0.98)",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  },
  inputGroup: {
    display: "grid",
    gridTemplateColumns: `${glyph.md} minmax(0, 1fr) auto`,
    alignItems: "center",
    gap: space.s2_5,
    flexShrink: 0,
    minHeight: 56,
    paddingInline: space.s5,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
    color: role.contentSecondary,
    cursor: "text",
  },
  inputIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    boxSizing: "border-box",
    width: "100%",
    height: `max(40px, ${target.min})`,
    margin: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: {
      default: type.fontBase,
      "@media (pointer: coarse)": `max(16px, ${type.fontBase})`,
    },
    lineHeight: type.leadingBase,
    "::placeholder": { color: role.contentSecondary },
  },
  list: {
    minHeight: 0,
    flex: "1 1 auto",
    padding: space.s2,
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollPaddingBlock: 8,
    outline: "none",
  },
  groupLabel: {
    paddingInline: space.s3,
    paddingBlockStart: space.s3,
    paddingBlockEnd: space.s1_5,
    color: role.contentSecondary,
    userSelect: "none",
  },
  item: {
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: `${glyph.md} minmax(0, 1fr) auto`,
    alignItems: "center",
    columnGap: space.s2_5,
    minHeight: `max(40px, ${target.min})`,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.card,
    outlineStyle: { default: "none", "[data-highlighted]": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
    backgroundColor: { default: "transparent", "[data-highlighted]": role.bgHover },
    color: { default: role.contentPrimary, "[data-disabled]": role.contentDisabled },
    scrollMarginBlock: 8,
    cursor: "default",
    userSelect: "none",
  },
  itemLeading: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: glyph.md,
    height: glyph.md,
    color: role.contentSecondary,
  },
  itemLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemMeta: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.s1,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },
  separator: {
    flexShrink: 0,
    height: 1,
    marginBlock: space.s1,
    marginInline: space.s3,
    backgroundColor: role.borderSecondaryTranslucent,
  },
  empty: {
    display: "grid",
    placeItems: "center",
    minHeight: { default: 0, ":not(:empty)": 152 },
    padding: { default: 0, ":not(:empty)": space.s6 },
    color: role.contentSecondary,
    textAlign: "center",
  },
});

function CommandTrigger({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Trigger.Props>): ReactElement {
  return <Dialog.Trigger {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

function CommandClose({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Close.Props>): ReactElement {
  return <Dialog.Close {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

type PaletteProps<ItemValue> = Pick<
  Autocomplete.Root.Props<ItemValue>,
  | "value"
  | "defaultValue"
  | "onValueChange"
  | "onItemHighlighted"
  | "itemToStringValue"
  | "loopFocus"
> & {
  /** Every row's `value`, in render order. The highlight follows this list as rows change. */
  readonly items: readonly ItemValue[];
};

function CommandPopup<ItemValue>({
  title = "Command palette",
  description,
  tint,
  items,
  loopFocus,
  value,
  defaultValue,
  onValueChange,
  onItemHighlighted,
  itemToStringValue,
  children,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Dialog.Popup.Props, Restyle<"Command.Popup">> &
  PaletteProps<ItemValue> & {
    /** The dialog's accessible name. Read by screen readers, never shown. */
    readonly title?: string;
    /** The dialog's accessible description. Read by screen readers, never shown. */
    readonly description?: string;
    /** Scopes the panel to a hue; the scrim stays neutral. */
    readonly tint?: Tint;
  }): ReactElement {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop data-slot="command-backdrop" {...props(styles.backdrop)} />
      <Dialog.Viewport {...props(styles.viewport)}>
        <Dialog.Popup
          data-slot="command-popup"
          {...rest}
          {...mergeStyleProps(
            props(
              tint !== undefined && surfaceTheme[tint],
              floatingSurfaceStyles.popup,
              floatingSurfaceStyles.modalPopup,
              styles.popup,
              xstyle,
            ),
            className,
            style,
          )}
        >
          <Dialog.Title {...props(srOnly)}>{title}</Dialog.Title>
          {description !== undefined && (
            <Dialog.Description {...props(srOnly)}>{description}</Dialog.Description>
          )}
          <Autocomplete.Root
            open
            inline
            mode="none"
            autoHighlight="always"
            keepHighlight
            loopFocus={loopFocus}
            items={items}
            value={value}
            defaultValue={defaultValue}
            onValueChange={onValueChange}
            onItemHighlighted={onItemHighlighted}
            itemToStringValue={itemToStringValue}
          >
            {children}
          </Autocomplete.Root>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  );
}

function CommandInput({
  trailing,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Autocomplete.Input.Props, Restyle<"Command.Input">> & {
  /** Right of the field: a shortcut hint, a clear button. */
  readonly trailing?: ReactNode;
}): ReactElement {
  return (
    <Autocomplete.InputGroup data-slot="command-input-group" {...props(styles.inputGroup)}>
      <span aria-hidden="true" {...props(styles.inputIcon)}>
        <Icon name="search" size={15} />
      </span>
      <Autocomplete.Input
        data-slot="command-input"
        autoComplete="off"
        spellCheck={false}
        {...rest}
        {...mergeStyleProps(props(styles.input, xstyle), className, style)}
      />
      {trailing}
    </Autocomplete.InputGroup>
  );
}

function CommandList({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Autocomplete.List.Props, Restyle<"Command.List">>): ReactElement {
  return (
    <Autocomplete.List
      data-slot="command-list"
      {...rest}
      {...mergeStyleProps(props(styles.list, xstyle), className, style)}
    />
  );
}

function CommandGroup({
  heading,
  children,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Autocomplete.Group.Props> & {
  /** Labels the group; the rows follow it. */
  readonly heading?: ReactNode;
}): ReactElement {
  return (
    <Autocomplete.Group
      data-slot="command-group"
      {...rest}
      {...mergeStyleProps(props(xstyle), className, style)}
    >
      {heading !== undefined && (
        <Autocomplete.GroupLabel {...props(text.sm, styles.groupLabel)}>
          {heading}
        </Autocomplete.GroupLabel>
      )}
      {children}
    </Autocomplete.Group>
  );
}

function CommandSeparator({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Autocomplete.Separator.Props, Restyle<"Command.Separator">>): ReactElement {
  return (
    <Autocomplete.Separator
      data-slot="command-separator"
      {...rest}
      {...mergeStyleProps(props(styles.separator, xstyle), className, style)}
    />
  );
}

function CommandItem<ItemValue>({
  value,
  leading,
  meta,
  children,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Omit<Autocomplete.Item.Props, "value">, Restyle<"Command.Item">> & {
  /** Identifies the row; it must appear in the popup's `items`. */
  readonly value: ItemValue;
  readonly leading?: ReactNode;
  /** Right column: a shortcut, a timestamp. Display only. */
  readonly meta?: ReactNode;
}): ReactElement {
  return (
    <Autocomplete.Item
      data-slot="command-item"
      value={value}
      {...rest}
      {...mergeStyleProps(props(text.base, styles.item, xstyle), className, style)}
    >
      <span aria-hidden="true" {...props(styles.itemLeading)}>
        {leading}
      </span>
      <span {...props(styles.itemLabel)}>{children}</span>
      {meta !== undefined && <span {...props(text.base, styles.itemMeta)}>{meta}</span>}
    </Autocomplete.Item>
  );
}

/** Shows its children while `items` is empty: nothing matched, still loading, failed. */
function CommandEmpty({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Autocomplete.Empty.Props, Restyle<"Command.Empty">>): ReactElement {
  return (
    <Autocomplete.Empty
      data-slot="command-empty"
      {...rest}
      {...mergeStyleProps(props(text.base, styles.empty, xstyle), className, style)}
    />
  );
}

const commandParts = {
  Root: Dialog.Root,
  Trigger: CommandTrigger,
  Popup: CommandPopup,
  Input: CommandInput,
  List: CommandList,
  Group: CommandGroup,
  Separator: CommandSeparator,
  Item: CommandItem,
  Empty: CommandEmpty,
  Close: CommandClose,
};

export { commandParts as Command };
