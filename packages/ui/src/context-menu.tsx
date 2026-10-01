import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import { floatingSurfaceStyles } from "./floating-surface.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { Icon } from "./icon.tsx";
import {
  MENU_COLLISION,
  MenuItemBody,
  menuItemStyle,
  menuStyles,
  useMenuPopupRef,
  type MenuItemRowProps,
  type MenuItemVariant,
} from "./menu.tsx";

export const ContextMenu = ContextMenuPrimitive.Root;

export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuGroup = ContextMenuPrimitive.Group;

export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

export const ContextMenuSub = ContextMenuPrimitive.SubmenuRoot;

export type ContextMenuContentProps = StyledProps<ContextMenuPrimitive.Popup.Props> &
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
  };

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
  ref,
  xstyle,
  className,
  style,
  ...rest
}: ContextMenuContentProps): ReactElement {
  const popupRef = useMenuPopupRef(ref);

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
          ref={popupRef}
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

export type ContextMenuSubContentProps = ContextMenuContentProps;

export function ContextMenuSubContent({
  side = "right",
  align = "start",
  sideOffset = 6,
  alignOffset,
  anchor,
  collisionAvoidance = MENU_COLLISION,
  collisionPadding = 8,
  tint,
  ref,
  xstyle,
  className,
  style,
  ...rest
}: ContextMenuSubContentProps): ReactElement {
  const popupRef = useMenuPopupRef(ref);

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
          ref={popupRef}
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

export type ContextMenuItemProps = StyledProps<ContextMenuPrimitive.Item.Props> &
  MenuItemRowProps & {
    readonly variant?: MenuItemVariant;
  };

export function ContextMenuItem({
  variant = "default",
  background,
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: ContextMenuItemProps): ReactElement {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      {...menuItemStyle({ background, layout }, variant, { xstyle, className, style })}
      {...rest}
    >
      <MenuItemBody icon={icon} leading={leading} meta={meta} layout={layout}>
        {children}
      </MenuItemBody>
    </ContextMenuPrimitive.Item>
  );
}

export type ContextMenuLinkItemProps = StyledProps<ContextMenuPrimitive.LinkItem.Props> &
  MenuItemRowProps;

export function ContextMenuLinkItem({
  background,
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: ContextMenuLinkItemProps): ReactElement {
  return (
    <ContextMenuPrimitive.LinkItem
      data-slot="context-menu-link-item"
      {...menuItemStyle({ background, layout }, "default", {
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

export type ContextMenuRadioItemProps = StyledProps<ContextMenuPrimitive.RadioItem.Props> &
  MenuItemRowProps;

export function ContextMenuRadioItem({
  closeOnClick = true,
  background,
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: ContextMenuRadioItemProps): ReactElement {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      closeOnClick={closeOnClick}
      {...menuItemStyle({ background, layout }, "default", { xstyle, className, style })}
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

export type ContextMenuCheckboxItemProps = StyledProps<ContextMenuPrimitive.CheckboxItem.Props> &
  MenuItemRowProps;

export function ContextMenuCheckboxItem({
  background,
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: ContextMenuCheckboxItemProps): ReactElement {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      {...menuItemStyle({ background, layout }, "default", { xstyle, className, style })}
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

export type ContextMenuSubTriggerProps = StyledProps<
  Omit<ContextMenuPrimitive.SubmenuTrigger.Props, "openOnHover">
> &
  Omit<MenuItemRowProps, "meta" | "background"> & {
    /** The current choice, shown before the chevron. */
    readonly value?: ReactNode;
  };

/** A row that opens its submenu on click and Arrow Right. */
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
}: ContextMenuSubTriggerProps): ReactElement {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      openOnHover={false}
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

export type ContextMenuSeparatorProps = StyledProps<ContextMenuPrimitive.Separator.Props> & {
  /** Stops short of the popup's edges instead of running through its padding. */
  readonly inset?: boolean;
};

export function ContextMenuSeparator({
  inset = false,
  xstyle,
  className,
  style,
  ...rest
}: ContextMenuSeparatorProps): ReactElement {
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

export type ContextMenuGroupLabelProps = StyledProps<ContextMenuPrimitive.GroupLabel.Props>;

export function ContextMenuGroupLabel({
  xstyle,
  className,
  style,
  ...rest
}: ContextMenuGroupLabelProps): ReactElement {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-group-label"
      {...mergeStyleProps(props(menuStyles.groupLabel, xstyle), className, style)}
      {...rest}
    />
  );
}
