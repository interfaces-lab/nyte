import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { floatingSurfaceStyles } from "./floating-surface.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { Icon } from "./icon.tsx";
import {
  MENU_COLLISION,
  MenuItemBody,
  menuItemStyle,
  menuStyles,
  type MenuItemBodyProps,
  type MenuItemVariant,
} from "./menu.tsx";

export const ContextMenu = ContextMenuPrimitive.Root;

export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuGroup = ContextMenuPrimitive.Group;

export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

export const ContextMenuSub = ContextMenuPrimitive.SubmenuRoot;

/** Opens at the pointer, or at `anchor`. */
export function ContextMenuContent({
  side,
  align,
  sideOffset,
  alignOffset,
  anchor,
  collisionAvoidance = MENU_COLLISION,
  collisionPadding = 8,
  tint,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ContextMenuPrimitive.Popup.Props> &
  Pick<
    ContextMenuPrimitive.Positioner.Props,
    | "side"
    | "align"
    | "sideOffset"
    | "alignOffset"
    | "anchor"
    | "collisionAvoidance"
    | "collisionPadding"
  > & {
    /** Scopes the popup to a hue. */
    readonly tint?: Tint;
  }): ReactElement {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        {...props(menuStyles.positioner)}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          {...mergeStyleProps(
            props(
              tint !== undefined && surfaceTheme[tint],
              floatingSurfaceStyles.popup,
              menuStyles.popup,
              menuStyles.rootPopupMotion,
              xstyle,
            ),
            className,
            style,
          )}
          {...rest}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuSubContent({
  side = "right",
  align = "start",
  sideOffset = 6,
  alignOffset,
  anchor,
  collisionAvoidance = MENU_COLLISION,
  collisionPadding = 8,
  tint,
  xstyle,
  className,
  style,
  ...rest
}: ComponentProps<typeof ContextMenuContent>): ReactElement {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset ?? (align === "center" ? 0 : -4)}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        {...props(menuStyles.submenuPositioner)}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-sub-content"
          {...mergeStyleProps(
            props(
              tint !== undefined && surfaceTheme[tint],
              floatingSurfaceStyles.popup,
              menuStyles.popup,
              menuStyles.submenuPopupMotion,
              xstyle,
            ),
            className,
            style,
          )}
          {...rest}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  variant = "default",
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<ContextMenuPrimitive.Item.Props> &
  MenuItemBodyProps & {
    readonly variant?: MenuItemVariant;
  }): ReactElement {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      {...menuItemStyle({ layout }, variant, { xstyle, className, style })}
      {...rest}
    >
      <MenuItemBody icon={icon} leading={leading} meta={meta} layout={layout}>
        {children}
      </MenuItemBody>
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuLinkItem({
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<ContextMenuPrimitive.LinkItem.Props> & MenuItemBodyProps): ReactElement {
  return (
    <ContextMenuPrimitive.LinkItem
      data-slot="context-menu-link-item"
      {...menuItemStyle({ layout }, "default", {
        xstyle: [menuStyles.link, xstyle],
        className,
        style,
      })}
      {...rest}
    >
      <MenuItemBody icon={icon} leading={leading} meta={meta} layout={layout}>
        {children}
      </MenuItemBody>
    </ContextMenuPrimitive.LinkItem>
  );
}

export function ContextMenuRadioItem({
  closeOnClick = true,
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<ContextMenuPrimitive.RadioItem.Props> & MenuItemBodyProps): ReactElement {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      closeOnClick={closeOnClick}
      {...menuItemStyle({ layout }, "default", { xstyle, className, style })}
      {...rest}
    >
      <MenuItemBody
        icon={icon}
        leading={leading}
        layout={layout}
        meta={
          <>
            {meta}
            <ContextMenuPrimitive.RadioItemIndicator {...props(menuStyles.indicator)}>
              <Icon name="checkmark" size={11} />
            </ContextMenuPrimitive.RadioItemIndicator>
          </>
        }
      >
        {children}
      </MenuItemBody>
    </ContextMenuPrimitive.RadioItem>
  );
}

export function ContextMenuCheckboxItem({
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<ContextMenuPrimitive.CheckboxItem.Props> & MenuItemBodyProps): ReactElement {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      {...menuItemStyle({ layout }, "default", { xstyle, className, style })}
      {...rest}
    >
      <MenuItemBody
        icon={icon}
        leading={leading}
        layout={layout}
        meta={
          <>
            {meta}
            <ContextMenuPrimitive.CheckboxItemIndicator {...props(menuStyles.indicator)}>
              <Icon name="checkmark" size={11} />
            </ContextMenuPrimitive.CheckboxItemIndicator>
          </>
        }
      >
        {children}
      </MenuItemBody>
    </ContextMenuPrimitive.CheckboxItem>
  );
}

/** A row that opens its submenu on hover, click, and Arrow Right. */
export function ContextMenuSubTrigger({
  value,
  layout,
  icon,
  leading,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<ContextMenuPrimitive.SubmenuTrigger.Props> &
  Omit<MenuItemBodyProps, "meta"> & {
    /** The current choice, shown before the chevron. */
    readonly value?: ReactNode;
  }): ReactElement {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      {...menuItemStyle({ layout }, "default", {
        xstyle: [menuStyles.submenuTriggerOpen, xstyle],
        className,
        style,
      })}
      {...rest}
    >
      <MenuItemBody
        icon={icon}
        leading={leading}
        layout={layout}
        meta={
          <>
            {value !== undefined && <span {...props(menuStyles.submenuValue)}>{value}</span>}
            <Icon name="chevron-right" size={11} />
          </>
        }
      >
        {children}
      </MenuItemBody>
    </ContextMenuPrimitive.SubmenuTrigger>
  );
}

export function ContextMenuSeparator({
  inset = false,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ContextMenuPrimitive.Separator.Props> & {
  /** Stops short of the popup's edges instead of running through its padding. */
  readonly inset?: boolean;
}): ReactElement {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      {...mergeStyleProps(
        props(menuStyles.separator, inset && menuStyles.separatorInset, xstyle),
        className,
        style,
      )}
      {...rest}
    />
  );
}

export function ContextMenuGroupLabel({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ContextMenuPrimitive.GroupLabel.Props>): ReactElement {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-group-label"
      {...mergeStyleProps(props(menuStyles.groupLabel, xstyle), className, style)}
      {...rest}
    />
  );
}
