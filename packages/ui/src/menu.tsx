/**
 * Menus over Base UI's Menu and ContextMenu: positioning, focus, typeahead,
 * dismissal, and roving tab index are the library's job. This file decides
 * geometry and colour once, so every menu opens the same surface.
 *
 * Every row's grid reserves the leading icon column and the trailing meta
 * column whether or not it fills them, so labels start and end on the same
 * edges in every menu.
 */
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { floatingSurfaceStyles } from "./floating-surface.stylex.ts";
import { glyph, layer, menu, radius, switchControl } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { intent, surfaceTheme, type Tint } from "./surface-theme.ts";
import { motion, role, shadow, type } from "./vars.stylex.ts";
import { Icon, type IconName } from "./icon.tsx";

export const MENU_COLLISION: NonNullable<MenuPrimitive.Positioner.Props["collisionAvoidance"]> = {
  side: "flip",
  align: "shift",
  fallbackAxisSide: "none",
};

export const menuStyles = create({
  positioner: { zIndex: layer.menu, outline: "none" },
  submenuPositioner: { zIndex: layer.submenu, outline: "none" },
  popup: {
    display: "flex",
    flexDirection: "column",
    minWidth: `min(max(${menu.width}, var(--anchor-width)), var(--available-width))`,
    maxWidth: `min(max(320px, var(--anchor-width)), var(--available-width))`,
    maxHeight: "var(--available-height)",
    padding: menu.padding,
    borderStyle: "none",
    borderRadius: menu.radius,
    outline: "none",
    color: role.contentPrimary,
    overflowY: "auto",
    overscrollBehavior: "contain",
    transformOrigin: "var(--transform-origin)",
  },
  anchorWidth: { width: "var(--anchor-width)", minWidth: 0, maxWidth: "none" },
  rootPopupMotion: {
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transform: {
      default: "none",
      "[data-starting-style][data-side='top']": "translate3d(0, 2px, 0) scale(0.98)",
      "[data-ending-style][data-side='top']": "translate3d(0, 2px, 0) scale(0.98)",
      "[data-starting-style][data-side='right']": "translate3d(-2px, 0, 0) scale(0.98)",
      "[data-ending-style][data-side='right']": "translate3d(-2px, 0, 0) scale(0.98)",
      "[data-starting-style][data-side='bottom']": "translate3d(0, -2px, 0) scale(0.98)",
      "[data-ending-style][data-side='bottom']": "translate3d(0, -2px, 0) scale(0.98)",
      "[data-starting-style][data-side='left']": "translate3d(2px, 0, 0) scale(0.98)",
      "[data-ending-style][data-side='left']": "translate3d(2px, 0, 0) scale(0.98)",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  },
  submenuPopupMotion: {
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transform: "none",
    transitionProperty: "opacity",
    transitionDuration: {
      default: "0ms",
      "[data-ending-style]": motion.durationInstant,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  item: {
    display: "grid",
    gridTemplateColumns: `${glyph.sm} minmax(0, 1fr) minmax(${menu.metaMinWidth}, auto)`,
    alignItems: "start",
    columnGap: menu.itemGap,
    minHeight: menu.itemHeight,
    paddingBlock: menu.itemPaddingBlock,
    paddingInline: menu.itemPaddingInline,
    borderRadius: menu.itemRadius,
    outline: "none",
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": role.bgHover,
    },
    color: { default: role.contentPrimary, "[data-disabled]": role.contentDisabled },
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    cursor: "default",
    userSelect: "none",
  },
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: glyph.sm,
    height: type.leadingBase,
  },
  label: {
    minWidth: 0,
    overflow: "hidden",
    lineHeight: type.leadingBase,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  link: { textDecoration: "none" },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: menu.metaMinWidth,
    minHeight: type.leadingBase,
    gap: 4,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    whiteSpace: "nowrap",
  },
  indicator: { display: "flex" },
  separator: {
    height: 1,
    marginBlock: 4,
    marginInline: `calc(${menu.padding} * -1)`,
    backgroundColor: role.borderSecondaryTranslucent,
  },
  separatorInset: { marginBlock: 4, marginInline: 8 },
  groupLabel: {
    display: "flex",
    alignItems: "center",
    minHeight: menu.itemHeight,
    paddingInline: 6,
    paddingBlock: 2,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    userSelect: "none",
  },
  submenuTriggerOpen: {
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": role.bgHover,
      "[data-popup-open]": role.bgInteractiveSecondaryTranslucent,
    },
  },
  submenuValue: {
    maxWidth: 112,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  switchTrack: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    width: switchControl.widthMd,
    height: switchControl.heightMd,
    padding: switchControl.paddingMd,
    borderRadius: radius.pill,
    backgroundColor: { default: role.bgControl, "[data-checked]": role.bgControlSelected },
    "::after": {
      content: '""',
      width: switchControl.knobMd,
      height: switchControl.knobMd,
      borderRadius: radius.pill,
      backgroundColor: role.contentOnControl,
      boxShadow: shadow.shadowSm,
      transform: {
        default: "translateX(0)",
        "[data-checked]": `translateX(calc(${switchControl.widthMd} - ${switchControl.knobMd} - ${switchControl.paddingMd} * 2))`,
      },
    },
  },
});

const itemVariants = create({
  default: {},
  danger: {
    color: { default: role.contentSecondary, "[data-disabled]": role.contentDisabled },
  },
});

/** `danger` paints the row in the danger hue. */
export type MenuItemVariant = keyof typeof itemVariants;

/** `plain` drops the leading icon column. */
const itemLayouts = create({
  menu: {},
  plain: { gridTemplateColumns: `minmax(0, 1fr) minmax(${menu.metaMinWidth}, auto)` },
});

export interface MenuItemBodyProps {
  readonly icon?: IconName;
  readonly leading?: ReactNode;
  /** Right column: a shortcut, a count, a provider name. */
  readonly meta?: ReactNode;
  readonly layout?: keyof typeof itemLayouts;
}

export function MenuItemBody({
  icon,
  leading,
  meta,
  layout = "menu",
  children,
}: MenuItemBodyProps & { readonly children?: ReactNode }): ReactElement {
  return (
    <>
      {layout !== "plain" && (
        <span aria-hidden="true" {...props(menuStyles.icon)}>
          {leading ?? (icon !== undefined && <Icon name={icon} size={14} />)}
        </span>
      )}
      <span {...props(menuStyles.label)}>{children}</span>
      {meta !== undefined && <span {...props(menuStyles.meta)}>{meta}</span>}
    </>
  );
}

export function menuItemStyle(
  { layout = "menu" }: Pick<MenuItemBodyProps, "layout">,
  variant: MenuItemVariant,
  { xstyle, className, style }: StyledProps<object>,
): ReturnType<typeof mergeStyleProps> {
  return mergeStyleProps(
    props(
      variant === "danger" && intent.danger,
      menuStyles.item,
      itemVariants[variant],
      itemLayouts[layout],
      xstyle,
    ),
    className,
    style,
  );
}

export const Menu = MenuPrimitive.Root;

export const MenuTrigger = MenuPrimitive.Trigger;

export const MenuGroup = MenuPrimitive.Group;

export const MenuRadioGroup = MenuPrimitive.RadioGroup;

export const MenuSub = MenuPrimitive.SubmenuRoot;

export function MenuContent({
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset,
  anchor,
  collisionAvoidance = MENU_COLLISION,
  collisionPadding = 8,
  tint,
  matchAnchorWidth = false,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MenuPrimitive.Popup.Props> &
  Pick<
    MenuPrimitive.Positioner.Props,
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
    /** Sizes the popup to its anchor, the trigger unless `anchor` names another element. */
    readonly matchAnchorWidth?: boolean;
  }): ReactElement {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        positionMethod="fixed"
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        {...props(menuStyles.positioner)}
      >
        <MenuPrimitive.Popup
          data-slot="menu-content"
          {...mergeStyleProps(
            props(
              tint !== undefined && surfaceTheme[tint],
              floatingSurfaceStyles.popup,
              menuStyles.popup,
              matchAnchorWidth && menuStyles.anchorWidth,
              menuStyles.rootPopupMotion,
              xstyle,
            ),
            className,
            style,
          )}
          {...rest}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuSubContent({
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
}: Omit<ComponentProps<typeof MenuContent>, "matchAnchorWidth">): ReactElement {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        positionMethod="fixed"
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset ?? (align === "center" ? 0 : -4)}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        {...props(menuStyles.submenuPositioner)}
      >
        <MenuPrimitive.Popup
          data-slot="menu-sub-content"
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
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  variant = "default",
  layout,
  icon,
  leading,
  meta,
  selected = false,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<MenuPrimitive.Item.Props> &
  MenuItemBodyProps & {
    readonly variant?: MenuItemVariant;
    readonly selected?: boolean;
  }): ReactElement {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      {...menuItemStyle({ layout }, variant, { xstyle, className, style })}
      {...rest}
    >
      <MenuItemBody
        icon={icon}
        leading={leading}
        layout={layout}
        meta={
          selected ? (
            <>
              {meta}
              <span {...props(menuStyles.indicator)}>
                <Icon name="checkmark" size={11} />
              </span>
            </>
          ) : (
            meta
          )
        }
      >
        {children}
      </MenuItemBody>
    </MenuPrimitive.Item>
  );
}

export function MenuLinkItem({
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<MenuPrimitive.LinkItem.Props> & MenuItemBodyProps): ReactElement {
  return (
    <MenuPrimitive.LinkItem
      data-slot="menu-link-item"
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
    </MenuPrimitive.LinkItem>
  );
}

export function MenuRadioItem({
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
}: StyledProps<MenuPrimitive.RadioItem.Props> & MenuItemBodyProps): ReactElement {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menu-radio-item"
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
            <MenuPrimitive.RadioItemIndicator {...props(menuStyles.indicator)}>
              <Icon name="checkmark" size={11} />
            </MenuPrimitive.RadioItemIndicator>
          </>
        }
      >
        {children}
      </MenuItemBody>
    </MenuPrimitive.RadioItem>
  );
}

export function MenuCheckboxItem({
  layout,
  icon,
  leading,
  meta,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<MenuPrimitive.CheckboxItem.Props> & MenuItemBodyProps): ReactElement {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menu-checkbox-item"
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
            <MenuPrimitive.CheckboxItemIndicator {...props(menuStyles.indicator)}>
              <Icon name="checkmark" size={11} />
            </MenuPrimitive.CheckboxItemIndicator>
          </>
        }
      >
        {children}
      </MenuItemBody>
    </MenuPrimitive.CheckboxItem>
  );
}

/** A checkbox item drawn as a switch; it stays open so the change is visible. */
export function MenuSwitchItem({
  layout,
  icon,
  leading,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<MenuPrimitive.CheckboxItem.Props> & Omit<MenuItemBodyProps, "meta">): ReactElement {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menu-switch-item"
      {...menuItemStyle({ layout }, "default", { xstyle, className, style })}
      {...rest}
    >
      <MenuItemBody
        icon={icon}
        leading={leading}
        layout={layout}
        meta={
          <MenuPrimitive.CheckboxItemIndicator
            keepMounted
            {...props(intent.primary, menuStyles.switchTrack)}
          />
        }
      >
        {children}
      </MenuItemBody>
    </MenuPrimitive.CheckboxItem>
  );
}

/** A row that opens its submenu on hover, click, and Arrow Right. */
export function MenuSubTrigger({
  value,
  layout,
  icon,
  leading,
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<MenuPrimitive.SubmenuTrigger.Props> &
  Omit<MenuItemBodyProps, "meta"> & {
    /** The current choice, shown before the chevron. */
    readonly value?: ReactNode;
  }): ReactElement {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="menu-sub-trigger"
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
    </MenuPrimitive.SubmenuTrigger>
  );
}

export function MenuSeparator({
  inset = false,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MenuPrimitive.Separator.Props> & {
  /** Stops short of the popup's edges instead of running through its padding. */
  readonly inset?: boolean;
}): ReactElement {
  return (
    <MenuPrimitive.Separator
      data-slot="menu-separator"
      {...mergeStyleProps(
        props(menuStyles.separator, inset && menuStyles.separatorInset, xstyle),
        className,
        style,
      )}
      {...rest}
    />
  );
}

export function MenuGroupLabel({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MenuPrimitive.GroupLabel.Props>): ReactElement {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menu-group-label"
      {...mergeStyleProps(props(menuStyles.groupLabel, xstyle), className, style)}
      {...rest}
    />
  );
}
