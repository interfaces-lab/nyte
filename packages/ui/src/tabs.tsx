import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, type ReactElement } from "react";

import { focus } from "./styles/a11y.stylex.ts";
import { button, media, radius, space, target } from "./styles/schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, motion, role, shadow, type } from "./styles/vars.stylex.ts";

const lists = create({
  segmented: {
    display: "grid",
    gridAutoFlow: { default: "column", '[data-orientation="vertical"]': "row" },
    gridAutoColumns: "1fr",
    alignItems: "center",
    gap: 0,
    padding: space.s0_5,
    borderRadius: `calc(${button.radiusSm} + 2px)`,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  underline: {
    display: "flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    gap: space.s4,
    boxShadow: `inset 0 -1px 0 ${role.borderSecondaryTranslucent}`,
  },
  pill: {
    display: "flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s0_5,
  },
  plain: {
    display: "flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    alignItems: "center",
    gap: space.s1,
  },
});

const tab = create({
  base: {
    boxSizing: "border-box",
    minWidth: target.min,
    minHeight: target.min,
    cursor: { default: appearance.cursorInteractive, "[data-disabled]": "default" },
    opacity: { default: 1, "[data-disabled]": 0.5 },
  },
  bare: {
    margin: 0,
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    letterSpacing: "inherit",
    textAlign: "start",
  },
});

const tabs = create({
  segmented: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s1_5,
    height: button.heightSm,
    paddingInline: button.paddingInlineSm,
    borderStyle: "none",
    borderRadius: button.radiusSm,
    backgroundColor: {
      default: "transparent",
      ":hover:not([data-active])": { [media.hover]: role.bgHover },
      "[data-active]": role.bgElevated,
    },
    boxShadow: { default: "none", "[data-active]": shadow.shadowSm },
    color: { default: role.contentInteractiveSecondary, "[data-active]": role.contentPrimary },
    fontFamily: type.fontSans,
    fontWeight: type.weightMedium,
    userSelect: "none",
    whiteSpace: "nowrap",
    scale: {
      default: "1",
      ":active": { default: "0.96", "@media (prefers-reduced-motion: reduce)": "1" },
    },
    transitionProperty: "background-color, color, scale",
    transitionDuration: { default: motion.durationFast, ":active": "0s" },
    transitionTimingFunction: motion.easeOut,
  },
  underline: {
    position: "relative",
    paddingBlock: `${space.s1} ${space.s2}`,
    paddingInline: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: {
      default: role.contentInteractiveSecondary,
      ":hover": { [media.hover]: role.contentInteractivePrimary },
      "[data-active]": role.contentPrimary,
    },
    fontFamily: type.fontSans,
    fontWeight: type.weightMedium,
    userSelect: "none",
    transitionProperty: "color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    "::after": {
      position: "absolute",
      insetInline: 0,
      insetBlockEnd: 0,
      height: 1.5,
      backgroundColor: { default: "transparent", ":is([data-active])": role.contentPrimary },
      content: '""',
    },
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    height: button.heightMd,
    paddingInline: button.pillPaddingInlineMd,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: role.borderSecondaryTranslucent,
      "[data-active]": role.borderPrimaryTranslucent,
    },
    backgroundColor: {
      default: "transparent",
      ":hover:not([data-active])": { [media.hover]: role.bgHover },
      "[data-active]": role.bgInteractiveSecondaryTranslucent,
    },
    color: { default: role.contentInteractiveSecondary, "[data-active]": role.contentPrimary },
    fontFamily: type.fontSans,
    fontWeight: type.weightMedium,
  },
  plain: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: button.heightMd,
    flexShrink: 0,
    paddingBlock: space.s0_5,
    paddingInline: space.s2_5,
    borderStyle: "none",
    borderRadius: radius.indicator,
    backgroundColor: {
      default: "transparent",
      ":hover:not([data-active])": { [media.hover]: role.bgHover },
      "[data-active]": role.bgInteractiveSecondaryTranslucent,
    },
    color: { default: role.contentInteractiveSecondary, "[data-active]": role.contentPrimary },
    fontFamily: type.fontSans,
  },
});

const indicator = create({
  list: { position: "relative" },
  base: {
    position: "absolute",
    top: "var(--active-tab-top)",
    left: "var(--active-tab-left)",
    width: "var(--active-tab-width)",
    height: "var(--active-tab-height)",
    transitionProperty: "top, left, width, height",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

const TabsVariantContext = createContext<keyof typeof tabs>("plain");

function TabsRoot({
  variant = "plain",
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<TabsPrimitive.Root.Props> & {
  readonly variant?: keyof typeof tabs;
}): ReactElement {
  return (
    <TabsVariantContext value={variant}>
      <TabsPrimitive.Root {...rest} {...mergeStyleProps(props(xstyle), className, style)} />
    </TabsVariantContext>
  );
}

function TabsList({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<TabsPrimitive.List.Props, Restyle<"Tabs.List">>): ReactElement {
  const variant = use(TabsVariantContext);

  return (
    <TabsPrimitive.List
      activateOnFocus={variant === "segmented"}
      {...rest}
      {...mergeStyleProps(props(indicator.list, lists[variant], xstyle), className, style)}
    />
  );
}

type TabsTabProps =
  | (StyledProps<TabsPrimitive.Tab.Props, Restyle<"Tabs.Tab">> & { readonly variant?: never })
  | (StyledProps<TabsPrimitive.Tab.Props, Restyle<"Tabs.Tab[variant=bare]">> & {
      readonly variant: "bare";
    });

function TabsTab({ variant: own, xstyle, className, style, ...rest }: TabsTabProps): ReactElement {
  const variant = use(TabsVariantContext);

  return (
    <TabsPrimitive.Tab
      {...rest}
      {...mergeStyleProps(
        props(
          own === "bare" ? tab.bare : [variant === "plain" ? text.base : text.sm, tabs[variant]],
          tab.base,
          variant === "plain" ? focus.ringInset : focus.ring,
          xstyle,
        ),
        className,
        style,
      )}
    />
  );
}

function TabsPanel({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<TabsPrimitive.Panel.Props>): ReactElement {
  return <TabsPrimitive.Panel {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

function TabsIndicator({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<TabsPrimitive.Indicator.Props, Restyle<"Tabs.Indicator">>): ReactElement {
  return (
    <TabsPrimitive.Indicator
      {...rest}
      {...mergeStyleProps(props(indicator.base, xstyle), className, style)}
    />
  );
}

export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanel,
  Indicator: TabsIndicator,
};
