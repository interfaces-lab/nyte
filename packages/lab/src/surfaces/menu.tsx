/**
 * The menu, in pieces. A panel, a group, a separator, an item and a submenu,
 * each doing one thing, so a caller composes a real menu instead of handing a
 * tree of data to one component.
 *
 * Open state belongs to the caller. Nothing here remembers anything.
 */
import { props } from "@stylexjs/stylex";
import { Icon } from "../shell/icon";
import { useId } from "react";
import type { ReactNode } from "react";
import { text } from "../tokens/type.stylex";
import { menu, rowRadius } from "./menu.stylex";
import { surface } from "./surface.stylex";

type ItemRowProps = {
  label: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  checked?: boolean;
  selected?: boolean;
  disabled?: boolean;
  danger?: boolean;
  expanded?: boolean;
  onActivate?: () => void;
  onExpand?: () => void;
  onCollapse?: () => void;
};

/**
 * One row, used by both the item and the submenu trigger. The leading slot is
 * always rendered, empty or not, which is what keeps a plain label in the same
 * column as one with an icon and in the same column as the heading above it.
 *
 * A string trailing is a shortcut and a node trailing is a glyph, because the
 * two want different boxes: text sizes itself and sits in the row's own type
 * step so it shares the label's baseline, artwork takes the fixed trailing
 * slot so it lines up down the menu.
 */
function ItemRow({
  label,
  leading,
  trailing,
  checked,
  selected,
  disabled,
  danger,
  expanded,
  onActivate,
  onExpand,
  onCollapse,
}: ItemRowProps) {
  return (
    <div
      data-grid-row="menu"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      aria-disabled={disabled}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
      aria-expanded={expanded}
      tabIndex={disabled === true ? -1 : 0}
      onClick={disabled === true ? undefined : onActivate}
      onKeyDown={(event) => {
        if (disabled === true) return;

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate?.();

          return;
        }

        if (event.key === "ArrowRight") {
          onExpand?.();

          return;
        }

        if (event.key === "ArrowLeft") {
          onCollapse?.();
        }
      }}
      {...props(
        menu.row,
        rowRadius,
        text.body,
        disabled === true ? menu.disabled : menu.interactive,
        selected === true && menu.selected,
        danger === true && menu.danger,
      )}
    >
      <span
        {...props(
          menu.slot,
          danger === true && menu.danger,
          disabled === true && menu.disabledSlot,
        )}
      >
        {checked === true ? <Icon name="check" /> : leading}
      </span>
      <span data-grid-text="" {...props(menu.label)}>
        {label}
      </span>
      {trailing === undefined ? null : typeof trailing === "string" ? (
        <span {...props(menu.shortcut)}>{trailing}</span>
      ) : (
        <span
          {...props(
            menu.trailingSlot,
            danger === true && menu.danger,
            disabled === true && menu.disabledSlot,
          )}
        >
          {trailing}
        </span>
      )}
    </div>
  );
}

type MenuProps = {
  label?: string;
  children: ReactNode;
};

/**
 * The panel. `surface.floating.popover` paints it: fill, backdrop filter,
 * hairline, radius, and the shadow that belongs to the popover layer.
 */
export function Menu({ label, children }: MenuProps) {
  return (
    <div role="menu" aria-label={label} {...props(surface.floating.popover, menu.panel)}>
      {children}
    </div>
  );
}

type MenuGroupProps = {
  label?: string;
  children: ReactNode;
};

export function MenuGroup({ label, children }: MenuGroupProps) {
  const headingId = useId();

  return (
    <div
      role="group"
      aria-labelledby={label === undefined ? undefined : headingId}
      {...props(menu.group)}
    >
      {label === undefined ? null : (
        <div
          id={headingId}
          data-grid-row="menu-heading"
          {...props(menu.row, menu.headingRow, text.label)}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" {...props(menu.separator)} />;
}

type MenuItemProps = {
  label: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  checked?: boolean;
  selected?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
};

export function MenuItem({
  label,
  leading,
  trailing,
  checked,
  selected,
  disabled,
  danger,
  onSelect,
}: MenuItemProps) {
  return (
    <ItemRow
      label={label}
      leading={leading}
      trailing={trailing}
      checked={checked}
      selected={selected}
      disabled={disabled}
      danger={danger}
      onActivate={onSelect}
    />
  );
}

type SubmenuProps = {
  label: string;
  leading?: ReactNode;
  open: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

/**
 * The trigger and its panel. The panel is a child of the anchor rather than a
 * sibling of the menu for two reasons: it is placed from the trigger row's
 * box, which is what the submenu offsets are derived against, and the pointer
 * never leaves the anchor's subtree while it crosses the overlap, so the
 * submenu does not close from under the cursor.
 *
 * The trigger holds the selected step while its submenu is open, which is
 * what makes the overlap read as one menu opening out of another rather than
 * two panels that happen to touch.
 *
 * `onOpenChange` is optional so a caller can pin the submenu open, which is
 * how the lab shows the two materials compositing without performing a hover.
 */
export function Submenu({ label, leading, open, disabled, onOpenChange, children }: SubmenuProps) {
  return (
    <div
      {...props(menu.anchor)}
      onPointerEnter={disabled === true ? undefined : () => onOpenChange?.(true)}
      onPointerLeave={disabled === true ? undefined : () => onOpenChange?.(false)}
    >
      <ItemRow
        label={label}
        leading={leading}
        trailing={<Icon name="chevron" />}
        selected={open}
        expanded={open}
        disabled={disabled}
        onActivate={() => onOpenChange?.(!open)}
        onExpand={() => onOpenChange?.(true)}
        onCollapse={() => onOpenChange?.(false)}
      />
      {open ? (
        <div
          role="menu"
          aria-label={label}
          {...props(surface.floating.submenu, menu.panel, menu.atSubmenu)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
