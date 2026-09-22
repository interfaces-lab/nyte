import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import { IconCheckmark1Small, IconChevronRightSmall } from "central-icons";
import type * as React from "react";

import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  overlayVars,
  radiusVars,
  spaceVars,
} from "../../platform-tokens.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { IconBox } from "./icon-box.tsx";

const menuStyles = stylex.create({
  positioner: { zIndex: overlayVars["--nyte-layer-menu"] },
  popup: {
    boxSizing: "border-box",
    width: "max-content",
    minWidth: overlayVars["--nyte-menu-min-width"],
    maxWidth: overlayVars["--nyte-menu-max-width"],
    maxHeight: overlayVars["--nyte-menu-max-height"],
    padding: spaceVars["--nyte-space-1"],
    overflowX: "hidden",
    overflowY: "auto",
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-menu"],
    backgroundColor: colorVars["--nyte-color-popover"],
    boxShadow: elevationVars["--nyte-elevation-menu"],
    color: colorVars["--nyte-color-popover-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
    outline: "none",
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    scale: { default: 1, "[data-starting-style]": 0.98, "[data-ending-style]": 0.98 },
    transitionProperty: "opacity, scale",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  item: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    minHeight: controlVars["--nyte-control-height-md"],
    gap: spaceVars["--nyte-space-2"],
    paddingInline: controlVars["--nyte-control-padding-sm"],
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--nyte-color-muted-hover"],
    },
    color: colorVars["--nyte-color-popover-foreground"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
    outline: "none",
    opacity: { default: 1, "[data-disabled]": controlVars["--nyte-control-disabled-opacity"] },
    userSelect: "none",
    transitionProperty: "background-color, color, opacity",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  destructive: {
    color: colorVars["--nyte-color-destructive"],
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--nyte-color-destructive-muted"],
    },
  },
  inset: { paddingInlineStart: controlVars["--nyte-control-menu-inset"] },
  indicatorGutter: { paddingInlineEnd: controlVars["--nyte-control-menu-inset"] },
  subTrigger: {
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--nyte-color-muted-hover"],
      "[data-popup-open]": colorVars["--nyte-color-muted-hover"],
    },
  },
  chevron: { marginInlineStart: "auto", flexShrink: 0 },
  label: {
    paddingInline: controlVars["--nyte-control-padding-sm"],
    paddingBlock: spaceVars["--nyte-space-1"],
    color: colorVars["--nyte-color-muted-foreground"],
    fontSize: fontVars["--nyte-font-size-detail"],
    fontWeight: fontVars["--nyte-font-weight-medium"],
    lineHeight: fontVars["--nyte-leading-detail"],
    userSelect: "none",
  },
  indicator: {
    pointerEvents: "none",
    position: "absolute",
    right: controlVars["--nyte-control-padding-sm"],
    display: "grid",
    placeItems: "center",
  },
  separator: {
    height: borderVars["--nyte-border-hairline-width"],
    marginBlock: spaceVars["--nyte-space-1"],
    marginInline: `calc(-1 * ${spaceVars["--nyte-space-1"]})`,
    backgroundColor: colorVars["--nyte-color-border"],
  },
  shortcut: {
    marginInlineStart: "auto",
    color: colorVars["--nyte-color-muted-foreground"],
    fontSize: fontVars["--nyte-font-size-detail"],
    letterSpacing: ".08em",
  },
});

export const DropdownMenu = MenuPrimitive.Root;

export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export const DropdownMenuSub = MenuPrimitive.SubmenuRoot;

export interface DropdownMenuContentProps extends StyledProps<MenuPrimitive.Popup.Props> {
  align?: MenuPrimitive.Positioner.Props["align"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  sideOffset?: number;
}

export function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  className,
  side = "bottom",
  sideOffset = 4,
  style,
  xstyle,
  ...props
}: DropdownMenuContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        {...stylex.props(menuStyles.positioner)}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          {...mergeStyleProps(stylex.props(menuStyles.popup, xstyle), className, style)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export interface DropdownMenuLabelProps extends StyledProps<MenuPrimitive.GroupLabel.Props> {
  inset?: boolean;
}

export function DropdownMenuLabel({
  className,
  inset = false,
  style,
  xstyle,
  ...props
}: DropdownMenuLabelProps) {
  return (
    <MenuPrimitive.GroupLabel
      data-inset={inset || undefined}
      data-slot="dropdown-menu-label"
      {...mergeStyleProps(
        stylex.props(menuStyles.label, inset && menuStyles.inset, xstyle),
        className,
        style,
      )}
      {...props}
    />
  );
}

export interface DropdownMenuItemProps extends StyledProps<MenuPrimitive.Item.Props> {
  inset?: boolean;
  variant?: "default" | "destructive";
}

export function DropdownMenuItem({
  className,
  inset = false,
  style,
  variant = "default",
  xstyle,
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      data-inset={inset || undefined}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      {...mergeStyleProps(
        stylex.props(
          menuStyles.item,
          inset && menuStyles.inset,
          variant === "destructive" && menuStyles.destructive,
          xstyle,
        ),
        className,
        style,
      )}
      {...props}
    />
  );
}

export interface DropdownMenuSubTriggerProps extends StyledProps<MenuPrimitive.SubmenuTrigger.Props> {
  inset?: boolean;
}

export function DropdownMenuSubTrigger({
  children,
  className,
  inset = false,
  style,
  xstyle,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-inset={inset || undefined}
      data-slot="dropdown-menu-sub-trigger"
      {...mergeStyleProps(
        stylex.props(menuStyles.item, menuStyles.subTrigger, inset && menuStyles.inset, xstyle),
        className,
        style,
      )}
      {...props}
    >
      {children}
      <IconBox glyphSize={12} xstyle={menuStyles.chevron}>
        <IconChevronRightSmall />
      </IconBox>
    </MenuPrimitive.SubmenuTrigger>
  );
}

export function DropdownMenuSubContent(props: DropdownMenuContentProps) {
  return (
    <DropdownMenuContent
      align="start"
      alignOffset={-3}
      data-slot="dropdown-menu-sub-content"
      side="right"
      sideOffset={0}
      {...props}
    />
  );
}

export interface DropdownMenuRadioItemProps extends StyledProps<MenuPrimitive.RadioItem.Props> {
  inset?: boolean;
}

export function DropdownMenuRadioItem({
  children,
  className,
  inset = false,
  style,
  xstyle,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem
      data-inset={inset || undefined}
      data-slot="dropdown-menu-radio-item"
      {...mergeStyleProps(
        stylex.props(
          menuStyles.item,
          menuStyles.indicatorGutter,
          inset && menuStyles.inset,
          xstyle,
        ),
        className,
        style,
      )}
      {...props}
    >
      {children}
      <span {...stylex.props(menuStyles.indicator)}>
        <MenuPrimitive.RadioItemIndicator>
          <IconBox glyphSize={12}>
            <IconCheckmark1Small />
          </IconBox>
        </MenuPrimitive.RadioItemIndicator>
      </span>
    </MenuPrimitive.RadioItem>
  );
}

export type DropdownMenuSeparatorProps = StyledProps<MenuPrimitive.Separator.Props>;

export function DropdownMenuSeparator({
  className,
  style,
  xstyle,
  ...props
}: DropdownMenuSeparatorProps) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      {...mergeStyleProps(stylex.props(menuStyles.separator, xstyle), className, style)}
      {...props}
    />
  );
}

export type DropdownMenuShortcutProps = StyledProps<React.ComponentProps<"span">>;

export function DropdownMenuShortcut({
  className,
  style,
  xstyle,
  ...props
}: DropdownMenuShortcutProps) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      {...mergeStyleProps(stylex.props(menuStyles.shortcut, xstyle), className, style)}
      {...props}
    />
  );
}
