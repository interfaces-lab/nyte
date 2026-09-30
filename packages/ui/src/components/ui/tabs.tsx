import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, type ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { button } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";

const lists = create({
  segmented: {
    display: "flex",
    alignItems: "center",
    gap: 1,
    padding: 2,
    borderRadius: t.radius8,
    backgroundColor: t.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${t.borderSecondaryTranslucent}`,
  },
  underline: {
    display: "flex",
    gap: 16,
    boxShadow: `inset 0 -1px 0 ${t.borderSecondaryTranslucent}`,
  },
  pill: { display: "flex", alignItems: "center", gap: 4, paddingBlock: 2 },
  plain: { display: "flex", alignItems: "center", gap: 4 },
});

const tabs = create({
  segmented: {
    flex: "1 1 0",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minWidth: 0,
    height: button.heightSm,
    paddingInline: button.paddingInlineSm,
    borderStyle: "none",
    borderRadius: button.radiusSm,
    backgroundColor: {
      default: "transparent",
      ":hover:not([data-active])": t.bgHover,
      "[data-active]": t.bgElevated,
    },
    boxShadow: { default: "none", "[data-active]": t.shadowSm },
    color: { default: t.contentInteractiveSecondary, "[data-active]": t.contentPrimary },
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    fontWeight: 500,
    lineHeight: t.leadingSm,
    cursor: t.cursorInteractive,
    userSelect: "none",
    whiteSpace: "nowrap",
    scale: {
      default: "1",
      ":active": { default: "0.96", "@media (prefers-reduced-motion: reduce)": "1" },
    },
    transitionProperty: "background-color, color, scale",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
  },
  underline: {
    position: "relative",
    paddingBlock: "4px 8px",
    paddingInline: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: {
      default: t.contentInteractiveSecondary,
      ":hover": t.contentInteractivePrimary,
      "[data-active]": t.contentPrimary,
    },
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    fontWeight: 500,
    lineHeight: t.leadingSm,
    cursor: t.cursorInteractive,
    userSelect: "none",
    transitionProperty: "color",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    "::after": {
      position: "absolute",
      insetInline: 0,
      insetBlockEnd: 0,
      height: 1.5,
      backgroundColor: { default: "transparent", ":is([data-active])": t.contentPrimary },
      content: '""',
    },
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    height: button.heightMd,
    paddingInline: button.pillPaddingInlineMd,
    borderRadius: t.radiusFull,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: t.borderSecondaryTranslucent,
      "[data-active]": t.borderPrimaryTranslucent,
    },
    backgroundColor: {
      default: "transparent",
      ":hover:not([data-active])": t.bgHover,
      "[data-active]": t.bgInteractiveSecondaryTranslucent,
    },
    color: { default: t.contentInteractiveSecondary, "[data-active]": t.contentPrimary },
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    fontWeight: 500,
    lineHeight: t.leadingSm,
    cursor: t.cursorInteractive,
  },
  plain: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: button.heightMd,
    flexShrink: 0,
    paddingBlock: 2,
    paddingInline: 10,
    borderStyle: "none",
    borderRadius: t.radius4,
    backgroundColor: {
      default: "transparent",
      ":hover:not([data-active])": t.bgHover,
      "[data-active]": t.bgInteractiveSecondaryTranslucent,
    },
    color: { default: t.contentInteractiveSecondary, "[data-active]": t.contentPrimary },
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    cursor: t.cursorInteractive,
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
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
});

/**
 * `segmented` fills its track, `underline` nests inside another strip, `pill`
 * filters a list, and `plain` switches a surface's content.
 */
export type TabsVariant = keyof typeof tabs;

const TabsVariantContext = createContext<TabsVariant>("plain");

export type TabsRootProps = StyledProps<TabsPrimitive.Root.Props> & {
  readonly variant?: TabsVariant;
};

export type TabsListProps = StyledProps<TabsPrimitive.List.Props>;

export type TabsTabProps = StyledProps<TabsPrimitive.Tab.Props>;

export type TabsPanelProps = StyledProps<TabsPrimitive.Panel.Props>;

export type TabsIndicatorProps = StyledProps<TabsPrimitive.Indicator.Props>;

function TabsRoot({
  variant = "plain",
  xstyle,
  className,
  style,
  ...rest
}: TabsRootProps): ReactElement {
  return (
    <TabsVariantContext value={variant}>
      <TabsPrimitive.Root {...rest} {...mergeStyleProps(props(xstyle), className, style)} />
    </TabsVariantContext>
  );
}

function TabsList({ xstyle, className, style, ...rest }: TabsListProps): ReactElement {
  const variant = use(TabsVariantContext);

  return (
    <TabsPrimitive.List
      {...rest}
      {...mergeStyleProps(props(indicator.list, lists[variant], xstyle), className, style)}
    />
  );
}

function TabsTab({ xstyle, className, style, ...rest }: TabsTabProps): ReactElement {
  const variant = use(TabsVariantContext);

  return (
    <TabsPrimitive.Tab
      {...rest}
      {...mergeStyleProps(
        props(tabs[variant], variant === "plain" ? focus.ringInset : focus.ring, xstyle),
        className,
        style,
      )}
    />
  );
}

function TabsPanel({ xstyle, className, style, ...rest }: TabsPanelProps): ReactElement {
  return <TabsPrimitive.Panel {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

/** A layer that follows the active tab. The caller paints it. */
function TabsIndicator({ xstyle, className, style, ...rest }: TabsIndicatorProps): ReactElement {
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
