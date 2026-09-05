/**
 * The desktop's menu, over Base UI's Menu: positioning, focus, typeahead,
 * dismissal, and roving tab index are the library's job. This file decides
 * geometry and colour once, so the pane header, the sidebar filter, and the
 * model chip all open the same surface.
 *
 * Every item reserves the leading icon slot and the trailing meta column
 * whether or not it uses them, so labels start and end on the same edges in
 * every menu.
 */
import { Menu as Base } from "@nyte-ai/ui/primitives";
import { ContextMenu as ContextBase } from "@nyte-ai/ui/primitives";
import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import type { StyleXStyles } from "@stylexjs/stylex";
import { floatingSurfaceStyles } from "../theme/floating-surface.stylex.ts";
import { control, layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { Icon, type IconName } from "./icons.tsx";

const MENU_COLLISION: NonNullable<Base.Positioner.Props["collisionAvoidance"]> = {
  side: "flip",
  align: "shift",
  fallbackAxisSide: "none",
};

const styles = stylex.create({
  positioner: { zIndex: layer.menu, outline: "none" },
  submenuPositioner: { zIndex: layer.submenu, outline: "none" },
  popup: {
    display: "flex",
    flexDirection: "column",
    minWidth: `min(${control.menuWidth}, var(--available-width))`,
    maxWidth: "min(320px, var(--available-width))",
    maxHeight: "var(--available-height)",
    padding: 4,
    borderStyle: "none",
    borderRadius: t.radius2xl,
    outline: "none",
    color: t.textPrimary,
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
    columnGap: 8,
    minHeight: control.compactHeight,
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: t.radiusLg,
    outline: "none",
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": t.bgCard,
      "[data-nyte-selected='true']": t.bgHover,
    },
    color: { default: t.textPrimary, "[data-disabled]": t.textDisabled },
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    cursor: "default",
    userSelect: "none",
  },
  itemSmall: {
    gridTemplateColumns: "12px minmax(0, 1fr) auto",
    columnGap: 6,
    minHeight: 24,
    paddingBlock: 3,
    paddingInline: 4,
    borderRadius: t.radiusSm,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  itemPlain: { gridTemplateColumns: "minmax(0, 1fr) auto" },
  itemDanger: { color: { default: t.textDanger, "[data-disabled]": t.textDisabled } },
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: t.leadingBase,
    opacity: 0.8,
  },
  iconSmall: { width: 12, height: t.leadingBase },
  label: {
    minWidth: 0,
    overflow: "hidden",
    lineHeight: t.leadingBase,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  labelSmall: { lineHeight: t.leadingBase },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: 32,
    minHeight: t.leadingBase,
    gap: 4,
    color: t.textTertiary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    whiteSpace: "nowrap",
  },
  metaSmall: { minHeight: t.leadingBase },
  separator: { height: 1, marginBlock: 3, marginInline: -4, backgroundColor: t.borderWeak },
  // The heading row owns the height; the label and the action are plain text
  // boxes with matching metrics, so they centre on the same line.
  groupHeading: { display: "flex", alignItems: "center", minHeight: control.compactHeight },
  groupLabel: {
    flex: 1,
    paddingInline: 6,
    paddingBlock: 3,
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    userSelect: "none",
  },
  groupAction: {
    paddingInline: 6,
    paddingBlock: 3,
    borderRadius: t.radiusBase,
    outline: "none",
    color: { default: t.textTertiary, "[data-highlighted]": t.textPrimary },
    backgroundColor: { default: "transparent", "[data-highlighted]": t.fillGhostHover },
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    cursor: "default",
    userSelect: "none",
  },
  submenuTriggerOpen: { backgroundColor: { "[data-popup-open]": t.bgCard } },
  submenuValue: {
    maxWidth: 112,
    overflow: "hidden",
    color: t.textTertiary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  switchTrack: {
    display: "inline-flex",
    alignItems: "center",
    width: 26,
    height: 16,
    padding: 2,
    borderRadius: t.radiusFull,
    backgroundColor: t.bgActive,
    boxShadow: `inset 0 0 0 1px ${t.strokeTertiary}`,
  },
  switchTrackOn: { backgroundColor: t.fillAccent, boxShadow: "none" },
  switchThumb: {
    width: 12,
    height: 12,
    borderRadius: t.radiusFull,
    backgroundColor: t.bgElevated,
    boxShadow: `0 1px 2px ${t.shadowControlColor}`,
    transform: "translateX(0)",
  },
  switchThumbOn: { transform: "translateX(10px)" },
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
    borderRadius: t.radius2xl,
    outline: "none",
    overflow: "hidden",
    color: t.textPrimary,
  },
});

const commandAnchor = {
  getBoundingClientRect(): DOMRect {
    const x = window.innerWidth / 2;
    const y = Math.min(144, Math.max(72, window.innerHeight * 0.12));
    return new DOMRect(x, y, 0, 0);
  },
};

export type MenuSide = Base.Positioner.Props["side"];
export type MenuAlign = Base.Positioner.Props["align"];
export type MenuAnchor = Base.Positioner.Props["anchor"];

export interface MenuProps {
  readonly label: string;
  /** DOM id for the popup, so a combobox can point `aria-controls` at it. */
  readonly id?: string;
  /** The element that opens the menu; Base UI merges the trigger props into it. */
  readonly trigger: ReactElement;
  readonly side?: MenuSide;
  readonly align?: MenuAlign;
  readonly anchor?: MenuAnchor;
  readonly sideOffset?: number;
  readonly alignOffset?: number;
  readonly collisionPadding?: number;
  /** Popup overrides such as a wider surface for long lists. */
  readonly popupStyle?: StyleXStyles;
  readonly open?: boolean;
  readonly modal?: boolean;
  readonly loopFocus?: boolean;
  readonly highlightItemOnHover?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onOpenChangeComplete?: (open: boolean) => void;
  readonly children: ReactNode;
}

export function Menu({
  label,
  id,
  trigger,
  side = "bottom",
  align = "start",
  anchor,
  sideOffset = 4,
  alignOffset,
  collisionPadding = 8,
  popupStyle,
  open,
  modal,
  loopFocus,
  highlightItemOnHover,
  onOpenChange,
  onOpenChangeComplete,
  children,
}: MenuProps): ReactElement {
  return (
    <Base.Root
      open={open}
      modal={modal}
      loopFocus={loopFocus}
      highlightItemOnHover={highlightItemOnHover}
      onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner
          positionMethod="fixed"
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          collisionPadding={collisionPadding}
          collisionAvoidance={MENU_COLLISION}
          {...stylex.props(styles.positioner)}
        >
          <Base.Popup
            id={id}
            aria-label={label}
            {...stylex.props(
              floatingSurfaceStyles.popup,
              styles.popup,
              styles.rootPopupMotion,
              popupStyle,
            )}
          >
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

export type MenuSize = "medium" | "small";

interface ItemBodyProps {
  readonly icon?: IconName;
  readonly leading?: ReactNode;
  /** Right column: a shortcut, a count, a provider name. */
  readonly meta?: ReactNode;
  readonly size?: MenuSize;
  readonly layout?: "menu" | "plain";
  readonly children: ReactNode;
}

function ItemBody({
  icon,
  leading,
  meta,
  size = "medium",
  layout = "menu",
  children,
}: ItemBodyProps): ReactElement {
  const small = size === "small";
  const plain = layout === "plain";
  return (
    <>
      {!plain && (
        <span aria-hidden="true" {...stylex.props(styles.icon, small && styles.iconSmall)}>
          {leading ?? (icon !== undefined && <Icon name={icon} size={small ? 12 : 14} />)}
        </span>
      )}
      <span {...stylex.props(styles.label, small && styles.labelSmall)}>{children}</span>
      <span {...stylex.props(styles.meta, small && styles.metaSmall)}>{meta}</span>
    </>
  );
}

export interface MenuItemProps extends ItemBodyProps {
  readonly id?: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly closeOnClick?: boolean;
  readonly textValue?: string;
  readonly selected?: boolean;
  readonly itemStyle?: StyleXStyles;
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
  size = "medium",
  layout = "menu",
  itemStyle,
  onPointerMove,
  onSelect,
  children,
}: MenuItemProps): ReactElement {
  return (
    <Base.Item
      id={id}
      disabled={disabled}
      closeOnClick={closeOnClick}
      label={textValue}
      data-nyte-selected={selected}
      {...stylex.props(
        styles.item,
        size === "small" && styles.itemSmall,
        layout === "plain" && styles.itemPlain,
        danger && styles.itemDanger,
        itemStyle,
      )}
      onClick={onSelect}
      onPointerMove={onPointerMove}
    >
      <ItemBody icon={icon} leading={leading} meta={meta} size={size} layout={layout}>
        {children}
      </ItemBody>
    </Base.Item>
  );
}

export const MenuRadioGroup = Base.RadioGroup;

export interface MenuRadioItemProps extends ItemBodyProps {
  readonly id?: string;
  readonly value: string;
  readonly disabled?: boolean;
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
  meta,
  disabled = false,
  closeOnClick = true,
  label,
  onFocus,
  size = "medium",
  layout = "menu",
  children,
}: MenuRadioItemProps): ReactElement {
  return (
    <Base.RadioItem
      id={id}
      value={value}
      disabled={disabled}
      closeOnClick={closeOnClick}
      label={label}
      onFocus={onFocus}
      {...stylex.props(
        styles.item,
        size === "small" && styles.itemSmall,
        layout === "plain" && styles.itemPlain,
      )}
    >
      <ItemBody
        icon={icon}
        size={size}
        layout={layout}
        meta={
          <>
            {meta}
            <Base.RadioItemIndicator>
              <Icon name="checkmark" size={11} />
            </Base.RadioItemIndicator>
          </>
        }
      >
        {children}
      </ItemBody>
    </Base.RadioItem>
  );
}

export interface MenuCheckboxItemProps extends ItemBodyProps {
  readonly checked: boolean;
  readonly disabled?: boolean;
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
  size = "medium",
  onCheckedChange,
  children,
}: MenuCheckboxItemProps): ReactElement {
  return (
    <Base.CheckboxItem
      checked={checked}
      disabled={disabled}
      closeOnClick={closeOnClick}
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
      {...stylex.props(styles.item, size === "small" && styles.itemSmall)}
    >
      <ItemBody
        icon={icon}
        leading={leading}
        size={size}
        meta={
          <>
            {meta}
            <Base.CheckboxItemIndicator>
              <Icon name="checkmark" size={11} />
            </Base.CheckboxItemIndicator>
          </>
        }
      >
        {children}
      </ItemBody>
    </Base.CheckboxItem>
  );
}

export interface MenuSwitchItemProps extends Omit<ItemBodyProps, "meta"> {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

export function MenuSwitchItem({
  checked,
  icon,
  leading,
  disabled = false,
  size = "medium",
  layout = "menu",
  onCheckedChange,
  children,
}: MenuSwitchItemProps): ReactElement {
  return (
    <Base.CheckboxItem
      checked={checked}
      disabled={disabled}
      closeOnClick={false}
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
      {...stylex.props(
        styles.item,
        size === "small" && styles.itemSmall,
        layout === "plain" && styles.itemPlain,
      )}
    >
      <ItemBody
        icon={icon}
        leading={leading}
        size={size}
        layout={layout}
        meta={
          <span
            aria-hidden="true"
            {...stylex.props(styles.switchTrack, checked && styles.switchTrackOn)}
          >
            <span {...stylex.props(styles.switchThumb, checked && styles.switchThumbOn)} />
          </span>
        }
      >
        {children}
      </ItemBody>
    </Base.CheckboxItem>
  );
}

export interface MenuSubmenuProps extends Omit<ItemBodyProps, "meta"> {
  readonly label: string;
  readonly value?: ReactNode;
  readonly disabled?: boolean;
  readonly align?: MenuAlign;
  readonly popupStyle?: StyleXStyles;
  readonly onOpenChangeComplete?: (open: boolean) => void;
}

export function MenuSubmenu({
  label,
  value,
  icon,
  leading,
  size = "medium",
  layout = "menu",
  disabled = false,
  align = "start",
  popupStyle,
  onOpenChangeComplete,
  children,
}: MenuSubmenuProps): ReactElement {
  return (
    <Base.SubmenuRoot onOpenChangeComplete={onOpenChangeComplete}>
      <Base.SubmenuTrigger
        disabled={disabled}
        label={label}
        openOnHover
        {...stylex.props(
          styles.item,
          size === "small" && styles.itemSmall,
          layout === "plain" && styles.itemPlain,
          styles.submenuTriggerOpen,
        )}
      >
        <ItemBody
          icon={icon}
          leading={leading}
          size={size}
          layout={layout}
          meta={
            <>
              {value !== undefined && <span {...stylex.props(styles.submenuValue)}>{value}</span>}
              <Icon name="chevron-right" size={11} />
            </>
          }
        >
          {label}
        </ItemBody>
      </Base.SubmenuTrigger>
      <Base.Portal>
        <Base.Positioner
          positionMethod="fixed"
          side="right"
          align={align}
          sideOffset={6}
          alignOffset={align === "center" ? 0 : -4}
          collisionPadding={8}
          collisionAvoidance={MENU_COLLISION}
          {...stylex.props(styles.submenuPositioner)}
        >
          <Base.Popup
            aria-label={label}
            {...stylex.props(
              floatingSurfaceStyles.popup,
              styles.popup,
              styles.submenuPopupMotion,
              popupStyle,
            )}
          >
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.SubmenuRoot>
  );
}

export function MenuSeparator(): ReactElement {
  return <Base.Separator {...stylex.props(styles.separator)} />;
}

export function ContextMenu({
  label,
  trigger,
  children,
}: {
  readonly label: string;
  readonly trigger: ReactElement;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <ContextBase.Root>
      <ContextBase.Trigger render={trigger} />
      <ContextBase.Portal>
        <ContextBase.Positioner
          collisionPadding={8}
          collisionAvoidance={MENU_COLLISION}
          {...stylex.props(styles.positioner)}
        >
          <ContextBase.Popup
            aria-label={label}
            {...stylex.props(floatingSurfaceStyles.popup, styles.popup, styles.rootPopupMotion)}
          >
            {children}
          </ContextBase.Popup>
        </ContextBase.Positioner>
      </ContextBase.Portal>
    </ContextBase.Root>
  );
}

export function ContextMenuItem({
  icon,
  leading,
  meta,
  disabled = false,
  danger = false,
  textValue,
  size = "medium",
  layout = "menu",
  onSelect,
  children,
}: MenuItemProps): ReactElement {
  return (
    <ContextBase.Item
      disabled={disabled}
      label={textValue}
      {...stylex.props(
        styles.item,
        size === "small" && styles.itemSmall,
        layout === "plain" && styles.itemPlain,
        danger && styles.itemDanger,
      )}
      onClick={onSelect}
    >
      <ItemBody icon={icon} leading={leading} meta={meta} size={size} layout={layout}>
        {children}
      </ItemBody>
    </ContextBase.Item>
  );
}

export function ContextMenuSeparator(): ReactElement {
  return <ContextBase.Separator {...stylex.props(styles.separator)} />;
}

export function MenuGroup({
  action,
  label,
  children,
}: {
  readonly action?: { readonly label: string; readonly onSelect: () => void };
  readonly label: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Base.Group>
      <div {...stylex.props(styles.groupHeading)}>
        <Base.GroupLabel {...stylex.props(styles.groupLabel)}>{label}</Base.GroupLabel>
        {action !== undefined && (
          <Base.Item
            closeOnClick={false}
            {...stylex.props(styles.groupAction)}
            onClick={action.onSelect}
          >
            {action.label}
          </Base.Item>
        )}
      </div>
      {children}
    </Base.Group>
  );
}

export interface CommandMenuProps {
  readonly label: string;
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly popupRef?: Ref<HTMLDivElement>;
  readonly children: ReactNode;
}

/** A modal Menu surface anchored to the viewport rather than its rail trigger. */
export function CommandMenu({
  label,
  trigger,
  open,
  onOpenChange,
  popupRef,
  children,
}: CommandMenuProps): ReactElement {
  const triggerID = useId();
  return (
    <Base.Root
      open={open}
      modal
      triggerId={triggerID}
      onOpenChange={(nextOpen) => onOpenChange(nextOpen)}
    >
      <Base.Trigger id={triggerID} render={trigger} />
      <Base.Portal>
        <Base.Backdrop {...stylex.props(styles.commandBackdrop)} />
        <Base.Positioner
          anchor={commandAnchor}
          positionMethod="fixed"
          side="bottom"
          align="center"
          collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
          collisionPadding={16}
          {...stylex.props(styles.commandPositioner)}
        >
          <Base.Popup
            ref={popupRef}
            aria-label={label}
            finalFocus={false}
            {...stylex.props(
              floatingSurfaceStyles.popup,
              floatingSurfaceStyles.modalPopup,
              styles.commandPopup,
            )}
          >
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
