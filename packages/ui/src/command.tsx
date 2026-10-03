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

import { srOnly } from "./a11y.stylex.ts";
import { floatingSurfaceStyles } from "./floating-surface.stylex.ts";
import { glyph, layer, radius, target } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { motion, role, type } from "./vars.stylex.ts";
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
    paddingBlockEnd: 16,
    paddingInline: 16,
    overflow: "hidden",
  },
  popup: {
    display: "flex",
    flexDirection: "column",
    width: "min(560px, 100%)",
    maxHeight: "min(430px, 100%)",
    borderStyle: "none",
    borderRadius: radius.surface,
    outline: "none",
    overflow: "hidden",
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
    gap: 10,
    flexShrink: 0,
    minHeight: 56,
    paddingInline: 20,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
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
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    "::placeholder": { color: role.contentTertiary },
  },
  list: {
    minHeight: 0,
    flex: "1 1 auto",
    padding: 8,
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollPaddingBlock: 8,
    outline: "none",
  },
  groupLabel: {
    paddingInline: 12,
    paddingBlockStart: 12,
    paddingBlockEnd: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    userSelect: "none",
  },
  item: {
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: `${glyph.md} minmax(0, 1fr) auto`,
    alignItems: "center",
    columnGap: 10,
    minHeight: `max(40px, ${target.min})`,
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: radius.card,
    outline: "none",
    backgroundColor: { default: "transparent", "[data-highlighted]": role.bgHover },
    color: { default: role.contentPrimary, "[data-disabled]": role.contentDisabled },
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
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
    gap: 4,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    whiteSpace: "nowrap",
  },
  separator: {
    flexShrink: 0,
    height: 1,
    marginBlock: 4,
    marginInline: 12,
    backgroundColor: role.borderSecondaryTranslucent,
  },
  empty: {
    display: { default: "none", ":not(:empty)": "grid" },
    placeItems: "center",
    minHeight: 152,
    padding: 24,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
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
  "value" | "defaultValue" | "onValueChange" | "onItemHighlighted" | "itemToStringValue"
> & {
  /** Every row's `value`, in render order. The highlight follows this list as rows change. */
  readonly items: readonly ItemValue[];
  /** Whether arrow keys wrap from the last row to the first. */
  readonly loop?: boolean;
};

function CommandPopup<ItemValue>({
  title = "Command palette",
  description,
  tint,
  items,
  loop = false,
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
}: StyledProps<Dialog.Popup.Props> &
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
            loopFocus={loop}
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
}: StyledProps<Autocomplete.Input.Props> & {
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
}: StyledProps<Autocomplete.List.Props>): ReactElement {
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
        <Autocomplete.GroupLabel {...props(styles.groupLabel)}>{heading}</Autocomplete.GroupLabel>
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
}: StyledProps<Autocomplete.Separator.Props>): ReactElement {
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
  onSelect,
  onClick,
  leading,
  meta,
  children,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Omit<Autocomplete.Item.Props, "value">> & {
  /** Identifies the row; it must appear in the popup's `items`. */
  readonly value: ItemValue;
  /** Runs when the row is clicked or chosen with Enter. */
  readonly onSelect?: (value: ItemValue) => void;
  readonly leading?: ReactNode;
  /** Right column: a shortcut, a timestamp. Display only. */
  readonly meta?: ReactNode;
}): ReactElement {
  return (
    <Autocomplete.Item
      data-slot="command-item"
      value={value}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        onSelect?.(value);
      }}
      {...mergeStyleProps(props(styles.item, xstyle), className, style)}
    >
      <span aria-hidden="true" {...props(styles.itemLeading)}>
        {leading}
      </span>
      <span {...props(styles.itemLabel)}>{children}</span>
      {meta !== undefined && <span {...props(styles.itemMeta)}>{meta}</span>}
    </Autocomplete.Item>
  );
}

/** Shows its children while `items` is empty: nothing matched, still loading, failed. */
function CommandEmpty({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Autocomplete.Empty.Props>): ReactElement {
  return (
    <Autocomplete.Empty
      data-slot="command-empty"
      {...rest}
      {...mergeStyleProps(props(styles.empty, xstyle), className, style)}
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
