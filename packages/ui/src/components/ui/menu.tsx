/**
 * Menus over Base UI's Menu and ContextMenu: positioning, focus, typeahead,
 * dismissal, and roving tab index are the library's job. This file decides
 * geometry and colour once, so every menu opens the same surface.
 *
 * Every item reserves the leading icon slot and the trailing meta column
 * whether or not it uses them, so labels start and end on the same edges in
 * every menu.
 */
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { create, props } from "@stylexjs/stylex";
import { useId } from "react";
import type { CSSProperties, ReactElement, ReactNode, Ref } from "react";

import { floatingSurfaceStyles } from "../../floating-surface.stylex.ts";
import { layer, menu, switchControl } from "../../schema.stylex.ts";
import { mergeStyleProps, type XStyle } from "../../style.ts";
import { intent, surfaceTheme, type Tint } from "../../surface-theme.ts";
import { t } from "../../vars.stylex.ts";
import { Icon, type IconName } from "./icon.tsx";
import { useOverlayRef } from "./overlay.tsx";
import { Hint, type HintProps } from "./tooltip.tsx";

const MENU_COLLISION: NonNullable<MenuPrimitive.Positioner.Props["collisionAvoidance"]> = {
  side: "flip",
  align: "shift",
  fallbackAxisSide: "none",
};

const styles = create({
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
    color: t.contentPrimary,
    overflowY: "auto",
    overscrollBehavior: "contain",
    transformOrigin: "var(--transform-origin)",
  },
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
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOutQuint,
  },
  submenuPopupMotion: {
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transform: "none",
    transitionProperty: "opacity",
    transitionDuration: {
      default: "0ms",
      "[data-ending-style]": t.durationInstant,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
  item: {
    display: "grid",
    gridTemplateColumns: "14px minmax(0, 1fr) auto",
    alignItems: "start",
    columnGap: menu.itemGap,
    minHeight: menu.itemHeight,
    paddingBlock: menu.itemPaddingBlock,
    paddingInline: menu.itemPaddingInline,
    borderRadius: menu.itemRadius,
    outline: "none",
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": t.bgHover,
      "[data-checked]": t.bgInteractiveSecondaryTranslucent,
      "[data-nyte-selected='true']": t.bgInteractiveSecondaryTranslucent,
    },
    // A selected row carries a hairline, so it reads apart from the hovered one.
    boxShadow: {
      default: "none",
      "[data-checked]": `inset 0 0 0 1px ${t.borderPrimary}`,
      "[data-nyte-selected='true']": `inset 0 0 0 1px ${t.borderPrimary}`,
    },
    color: { default: t.contentPrimary, "[data-disabled]": t.contentDisabled },
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    cursor: "default",
    userSelect: "none",
  },
  itemHighlightOnly: {
    backgroundColor: {
      default: "transparent",
      "[data-checked]": "transparent",
      "[data-highlighted]": t.bgHover,
      "[data-checked][data-highlighted]": t.bgHover,
    },
    boxShadow: "none",
  },
  itemPlain: { gridTemplateColumns: "minmax(0, 1fr) auto" },
  itemDanger: { color: { default: t.intentDangerContent, "[data-disabled]": t.contentDisabled } },
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: t.leadingBase,
    color: t.contentSecondary,
  },
  iconDanger: { color: t.intentDangerContent },
  iconDisabled: { color: t.contentTertiary },
  label: {
    minWidth: 0,
    overflow: "hidden",
    lineHeight: t.leadingBase,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: 32,
    minHeight: t.leadingBase,
    gap: 4,
    color: t.contentSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    whiteSpace: "nowrap",
  },
  separator: {
    height: 1,
    marginBlock: 4,
    marginInline: `calc(${menu.padding} * -1)`,
    backgroundColor: t.borderSecondaryTranslucent,
  },
  separatorInset: { marginBlock: 4, marginInline: 8 },
  groupHeading: { display: "flex", alignItems: "center", minHeight: menu.itemHeight },
  groupLabel: {
    flex: 1,
    paddingInline: 6,
    paddingBlock: 2,
    color: t.contentSecondary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    userSelect: "none",
  },
  groupAction: {
    paddingInline: 6,
    paddingBlock: 2,
    borderRadius: t.radius6,
    outline: "none",
    color: {
      default: t.contentInteractiveSecondary,
      "[data-highlighted]": t.contentInteractivePrimary,
    },
    backgroundColor: { default: "transparent", "[data-highlighted]": t.bgHover },
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    cursor: "default",
    userSelect: "none",
  },
  submenuTriggerOpen: {
    backgroundColor: { "[data-popup-open]": t.bgInteractiveSecondaryTranslucent },
  },
  submenuValue: {
    maxWidth: 112,
    overflow: "hidden",
    color: t.contentSecondary,
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
    borderRadius: t.radiusFull,
    backgroundColor: t.bgControl,
  },
  switchTrackOn: { backgroundColor: t.bgControlSelected },
  switchThumb: {
    width: switchControl.knobMd,
    height: switchControl.knobMd,
    borderRadius: t.radiusFull,
    backgroundColor: t.contentOnControl,
    boxShadow: t.shadowSm,
    transform: "translateX(0)",
  },
  switchThumbOn: {
    transform: `translateX(calc(${switchControl.widthMd} - ${switchControl.knobMd} - ${switchControl.paddingMd} * 2))`,
  },
  commandBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: layer.commandBackdrop,
    backgroundColor: t.bgScrim,
  },
  commandPositioner: { zIndex: layer.command, outline: "none" },
  commandPopup: {
    display: "flex",
    flexDirection: "column",
    width: "min(560px, calc(100vw - 32px))",
    maxHeight: "min(430px, calc(100vh - 96px))",
    borderStyle: "none",
    borderRadius: t.radius14,
    outline: "none",
    overflow: "hidden",
    color: t.contentPrimary,
  },
});

const commandAnchor = {
  getBoundingClientRect(): DOMRect {
    const x = window.innerWidth / 2;
    const y = Math.min(144, Math.max(72, window.innerHeight * 0.12));

    return new DOMRect(x, y, 0, 0);
  },
};

interface MenuStyleProps {
  /** Merged last onto the part's own styles. */
  readonly xstyle?: XStyle;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export type MenuSide = MenuPrimitive.Positioner.Props["side"];

export type MenuAlign = MenuPrimitive.Positioner.Props["align"];

export type MenuAnchor = MenuPrimitive.Positioner.Props["anchor"];

export type MenuProps = MenuStyleProps &
  Pick<
    MenuPrimitive.Root.Props,
    | "open"
    | "modal"
    | "loopFocus"
    | "highlightItemOnHover"
    | "onOpenChange"
    | "onOpenChangeComplete"
  > &
  Pick<
    MenuPrimitive.Positioner.Props,
    "side" | "align" | "anchor" | "sideOffset" | "alignOffset" | "collisionPadding"
  > &
  Pick<MenuPrimitive.Popup.Props, "id" | "finalFocus"> & {
    readonly label: string;
    readonly trigger: NonNullable<MenuPrimitive.Trigger.Props["render"]>;
    readonly hint?: Omit<HintProps, "trigger">;
    /** Scopes the popup to a hue. */
    readonly tint?: Tint;
    readonly children: ReactNode;
  };

export function Menu({
  label,
  id,
  trigger,
  hint,
  side = "bottom",
  align = "start",
  anchor,
  sideOffset = 4,
  alignOffset,
  collisionPadding = 8,
  open,
  modal,
  loopFocus,
  highlightItemOnHover,
  finalFocus,
  onOpenChange,
  onOpenChangeComplete,
  tint,
  xstyle,
  className,
  style,
  children,
}: MenuProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <MenuPrimitive.Root
      open={open}
      modal={modal}
      loopFocus={loopFocus}
      highlightItemOnHover={highlightItemOnHover}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {hint === undefined ? (
        <MenuPrimitive.Trigger render={trigger} />
      ) : (
        <Hint {...hint} trigger={<MenuPrimitive.Trigger render={trigger} />} />
      )}
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          positionMethod="fixed"
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          collisionPadding={collisionPadding}
          collisionAvoidance={MENU_COLLISION}
          {...props(styles.positioner)}
        >
          <MenuPrimitive.Popup
            ref={overlayRef}
            id={id}
            aria-label={label}
            finalFocus={finalFocus}
            {...mergeStyleProps(
              props(
                tint !== undefined && surfaceTheme[tint],
                floatingSurfaceStyles.popup,
                styles.popup,
                styles.rootPopupMotion,
                xstyle,
              ),
              className,
              style,
            )}
          >
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

/**
 * How a row paints its background. `highlightOnly` suppresses the checked fill,
 * leaving the pointer highlight as the row's only paint, for rows whose own
 * control already shows their state.
 */
export type MenuItemBackground = "default" | "highlightOnly";

/** `plain` drops the leading icon column. */
export type MenuItemLayout = "menu" | "plain";

interface ItemBodyProps {
  readonly icon?: IconName;
  readonly leading?: ReactNode;
  /** Right column: a shortcut, a count, a provider name. */
  readonly meta?: ReactNode;
  readonly layout?: MenuItemLayout;
  readonly children: ReactNode;
}

function ItemBody({
  danger = false,
  disabled = false,
  icon,
  leading,
  meta,
  layout = "menu",
  children,
}: ItemBodyProps & { readonly danger?: boolean; readonly disabled?: boolean }): ReactElement {
  return (
    <>
      {layout !== "plain" && (
        <span
          aria-hidden="true"
          {...props(styles.icon, danger && styles.iconDanger, disabled && styles.iconDisabled)}
        >
          {leading ?? (icon !== undefined && <Icon name={icon} size={14} />)}
        </span>
      )}
      <span {...props(styles.label)}>{children}</span>
      <span {...props(styles.meta)}>{meta}</span>
    </>
  );
}

function itemStyles(
  { background, layout }: Pick<ItemRowProps, "background" | "layout">,
  danger: boolean,
  { xstyle, className, style }: MenuStyleProps,
): ReturnType<typeof mergeStyleProps> {
  return mergeStyleProps(
    props(
      styles.item,
      background === "highlightOnly" && styles.itemHighlightOnly,
      layout === "plain" && styles.itemPlain,
      danger && styles.itemDanger,
      xstyle,
    ),
    className,
    style,
  );
}

interface ItemRowProps extends ItemBodyProps, MenuStyleProps {
  readonly disabled?: boolean;
  readonly background?: MenuItemBackground;
}

export interface MenuItemProps extends ItemRowProps {
  readonly id?: string;
  readonly danger?: boolean;
  readonly closeOnClick?: boolean;
  /** Typeahead text when the body is more than a label. */
  readonly textValue?: string;
  readonly selected?: boolean;
  readonly onPointerMove?: () => void;
  readonly onSelect: () => void;
}

export function MenuItem({
  id,
  icon,
  leading,
  meta,
  disabled = false,
  danger = false,
  closeOnClick = true,
  textValue,
  selected = false,
  background = "default",
  layout = "menu",
  xstyle,
  className,
  style,
  onPointerMove,
  onSelect,
  children,
}: MenuItemProps): ReactElement {
  return (
    <MenuPrimitive.Item
      id={id}
      disabled={disabled}
      closeOnClick={closeOnClick}
      label={textValue}
      data-nyte-selected={selected}
      {...itemStyles({ background, layout }, danger, { xstyle, className, style })}
      onClick={onSelect}
      onPointerMove={onPointerMove}
    >
      <ItemBody
        danger={danger}
        disabled={disabled}
        icon={icon}
        leading={leading}
        meta={meta}
        layout={layout}
      >
        {children}
      </ItemBody>
    </MenuPrimitive.Item>
  );
}

export const MenuRadioGroup = MenuPrimitive.RadioGroup;

export interface MenuRadioItemProps extends ItemRowProps {
  readonly id?: string;
  readonly value: string;
  readonly closeOnClick?: boolean;
  /** Typeahead text when the body is more than a label. */
  readonly label?: string;
  /** Base UI focuses the highlighted item, so this is the highlight signal. */
  readonly onFocus?: () => void;
}

export function MenuRadioItem({
  id,
  value,
  icon,
  leading,
  meta,
  disabled = false,
  closeOnClick = true,
  label,
  onFocus,
  background = "default",
  layout = "menu",
  xstyle,
  className,
  style,
  children,
}: MenuRadioItemProps): ReactElement {
  return (
    <MenuPrimitive.RadioItem
      id={id}
      value={value}
      disabled={disabled}
      closeOnClick={closeOnClick}
      label={label}
      onFocus={onFocus}
      {...itemStyles({ background, layout }, false, { xstyle, className, style })}
    >
      <ItemBody
        disabled={disabled}
        icon={icon}
        leading={leading}
        layout={layout}
        meta={
          <>
            {meta}
            <MenuPrimitive.RadioItemIndicator>
              <Icon name="checkmark" size={11} />
            </MenuPrimitive.RadioItemIndicator>
          </>
        }
      >
        {children}
      </ItemBody>
    </MenuPrimitive.RadioItem>
  );
}

export interface MenuCheckboxItemProps extends ItemRowProps {
  readonly checked: boolean;
  readonly closeOnClick?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

export function MenuCheckboxItem({
  checked,
  icon,
  leading,
  meta,
  disabled = false,
  closeOnClick = false,
  background = "default",
  layout = "menu",
  xstyle,
  className,
  style,
  onCheckedChange,
  children,
}: MenuCheckboxItemProps): ReactElement {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      disabled={disabled}
      closeOnClick={closeOnClick}
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
      {...itemStyles({ background, layout }, false, { xstyle, className, style })}
    >
      <ItemBody
        disabled={disabled}
        icon={icon}
        leading={leading}
        layout={layout}
        meta={
          <>
            {meta}
            <MenuPrimitive.CheckboxItemIndicator>
              <Icon name="checkmark" size={11} />
            </MenuPrimitive.CheckboxItemIndicator>
          </>
        }
      >
        {children}
      </ItemBody>
    </MenuPrimitive.CheckboxItem>
  );
}

export interface MenuSwitchItemProps extends Omit<ItemRowProps, "meta"> {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

/** A checkbox item drawn as a switch; it stays open so the change is visible. */
export function MenuSwitchItem({
  checked,
  icon,
  leading,
  disabled = false,
  background = "default",
  layout = "menu",
  xstyle,
  className,
  style,
  onCheckedChange,
  children,
}: MenuSwitchItemProps): ReactElement {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      disabled={disabled}
      closeOnClick={false}
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
      {...itemStyles({ background, layout }, false, { xstyle, className, style })}
    >
      <ItemBody
        disabled={disabled}
        icon={icon}
        leading={leading}
        layout={layout}
        meta={
          <span
            aria-hidden="true"
            {...props(intent.primary, styles.switchTrack, checked && styles.switchTrackOn)}
          >
            <span {...props(styles.switchThumb, checked && styles.switchThumbOn)} />
          </span>
        }
      >
        {children}
      </ItemBody>
    </MenuPrimitive.CheckboxItem>
  );
}

export interface MenuSubmenuProps extends Omit<ItemBodyProps, "meta">, MenuStyleProps {
  readonly label: string;
  /** The current choice, shown before the chevron. */
  readonly value?: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: MenuPrimitive.SubmenuRoot.Props["onOpenChange"];
  readonly disabled?: boolean;
  readonly align?: MenuAlign;
  readonly onOpenChangeComplete?: (open: boolean) => void;
  /** Scopes the nested popup to a hue. */
  readonly tint?: Tint;
}

/** A row that opens a nested menu on hover; `xstyle`, `className`, and `style` go to its popup. */
export function MenuSubmenu({
  label,
  value,
  open,
  onOpenChange,
  icon,
  leading,
  layout = "menu",
  disabled = false,
  align = "start",
  tint,
  xstyle,
  className,
  style,
  onOpenChangeComplete,
  children,
}: MenuSubmenuProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <MenuPrimitive.SubmenuRoot
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <MenuPrimitive.SubmenuTrigger
        disabled={disabled}
        label={label}
        openOnHover
        {...props(styles.item, layout === "plain" && styles.itemPlain, styles.submenuTriggerOpen)}
      >
        <ItemBody
          disabled={disabled}
          icon={icon}
          leading={leading}
          layout={layout}
          meta={
            <>
              {value !== undefined && <span {...props(styles.submenuValue)}>{value}</span>}
              <Icon name="chevron-right" size={11} />
            </>
          }
        >
          {label}
        </ItemBody>
      </MenuPrimitive.SubmenuTrigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          positionMethod="fixed"
          side="right"
          align={align}
          sideOffset={6}
          alignOffset={align === "center" ? 0 : -4}
          collisionPadding={8}
          collisionAvoidance={MENU_COLLISION}
          {...props(styles.submenuPositioner)}
        >
          <MenuPrimitive.Popup
            ref={overlayRef}
            aria-label={label}
            {...mergeStyleProps(
              props(
                tint !== undefined && surfaceTheme[tint],
                floatingSurfaceStyles.popup,
                styles.popup,
                styles.submenuPopupMotion,
                xstyle,
              ),
              className,
              style,
            )}
          >
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.SubmenuRoot>
  );
}

export interface MenuSeparatorProps extends MenuStyleProps {
  /** Stops short of the popup's edges instead of running through its padding. */
  readonly inset?: boolean;
}

export function MenuSeparator({
  inset = false,
  xstyle,
  className,
  style,
}: MenuSeparatorProps): ReactElement {
  return (
    <MenuPrimitive.Separator
      {...mergeStyleProps(
        props(styles.separator, inset && styles.separatorInset, xstyle),
        className,
        style,
      )}
    />
  );
}

export interface MenuGroupProps extends MenuStyleProps {
  /** A small text action on the heading row, such as "Clear". */
  readonly action?: { readonly label: string; readonly onSelect: () => void };
  readonly label: ReactNode;
  readonly children: ReactNode;
}

export function MenuGroup({
  action,
  label,
  xstyle,
  className,
  style,
  children,
}: MenuGroupProps): ReactElement {
  return (
    <MenuPrimitive.Group {...mergeStyleProps(props(xstyle), className, style)}>
      <div {...props(styles.groupHeading)}>
        <MenuPrimitive.GroupLabel {...props(styles.groupLabel)}>{label}</MenuPrimitive.GroupLabel>
        {action !== undefined && (
          <MenuPrimitive.Item
            closeOnClick={false}
            {...props(styles.groupAction)}
            onClick={action.onSelect}
          >
            {action.label}
          </MenuPrimitive.Item>
        )}
      </div>
      {children}
    </MenuPrimitive.Group>
  );
}

export interface CommandMenuProps extends MenuStyleProps {
  readonly label: string;
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly popupRef?: Ref<HTMLDivElement>;
  /** Scopes the popup to a hue. */
  readonly tint?: Tint;
  readonly children: ReactNode;
}

/** A modal menu over a scrim, anchored near the top of the viewport rather than its trigger. */
export function CommandMenu({
  label,
  trigger,
  open,
  onOpenChange,
  popupRef,
  tint,
  xstyle,
  className,
  style,
  children,
}: CommandMenuProps): ReactElement {
  const triggerID = useId();
  const overlayRef = useOverlayRef();

  return (
    <MenuPrimitive.Root
      open={open}
      modal
      triggerId={triggerID}
      onOpenChange={(nextOpen) => onOpenChange(nextOpen)}
    >
      <MenuPrimitive.Trigger id={triggerID} render={trigger} />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Backdrop ref={overlayRef} {...props(styles.commandBackdrop)} />
        <MenuPrimitive.Positioner
          anchor={commandAnchor}
          positionMethod="fixed"
          side="bottom"
          align="center"
          collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
          collisionPadding={16}
          {...props(styles.commandPositioner)}
        >
          <MenuPrimitive.Popup
            ref={popupRef}
            aria-label={label}
            finalFocus={false}
            {...mergeStyleProps(
              props(
                tint !== undefined && surfaceTheme[tint],
                floatingSurfaceStyles.popup,
                floatingSurfaceStyles.modalPopup,
                styles.commandPopup,
                xstyle,
              ),
              className,
              style,
            )}
          >
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export interface ContextMenuProps extends MenuStyleProps {
  readonly label: string;
  /** The area that opens the menu on right-click or long press. */
  readonly trigger: ReactElement;
  readonly open?: boolean;
  readonly onOpenChange?: ContextMenuPrimitive.Root.Props["onOpenChange"];
  /** Scopes the popup to a hue. */
  readonly tint?: Tint;
  readonly children: ReactNode;
}

export function ContextMenu({
  label,
  trigger,
  open,
  onOpenChange,
  tint,
  xstyle,
  className,
  style,
  children,
}: ContextMenuProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <ContextMenuPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <ContextMenuPrimitive.Trigger render={trigger} />
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Positioner
          collisionPadding={8}
          collisionAvoidance={MENU_COLLISION}
          {...props(styles.positioner)}
        >
          <ContextMenuPrimitive.Popup
            ref={overlayRef}
            aria-label={label}
            {...mergeStyleProps(
              props(
                tint !== undefined && surfaceTheme[tint],
                floatingSurfaceStyles.popup,
                styles.popup,
                styles.rootPopupMotion,
                xstyle,
              ),
              className,
              style,
            )}
          >
            {children}
          </ContextMenuPrimitive.Popup>
        </ContextMenuPrimitive.Positioner>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

export type ContextMenuItemProps = Omit<
  MenuItemProps,
  "id" | "closeOnClick" | "selected" | "onPointerMove"
>;

export function ContextMenuItem({
  icon,
  leading,
  meta,
  disabled = false,
  danger = false,
  textValue,
  background = "default",
  layout = "menu",
  xstyle,
  className,
  style,
  onSelect,
  children,
}: ContextMenuItemProps): ReactElement {
  return (
    <ContextMenuPrimitive.Item
      disabled={disabled}
      label={textValue}
      {...itemStyles({ background, layout }, danger, { xstyle, className, style })}
      onClick={onSelect}
    >
      <ItemBody
        danger={danger}
        disabled={disabled}
        icon={icon}
        leading={leading}
        meta={meta}
        layout={layout}
      >
        {children}
      </ItemBody>
    </ContextMenuPrimitive.Item>
  );
}

export type ContextMenuSeparatorProps = MenuStyleProps;

export function ContextMenuSeparator({
  xstyle,
  className,
  style,
}: ContextMenuSeparatorProps): ReactElement {
  return (
    <ContextMenuPrimitive.Separator
      {...mergeStyleProps(props(styles.separator, xstyle), className, style)}
    />
  );
}
