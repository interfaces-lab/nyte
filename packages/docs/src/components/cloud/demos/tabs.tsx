"use client";

import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  root: {
    width: "320px",
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
  },
  list: {
    position: "relative",
    display: "flex",
    gap: spaceVars["--nyte-space-1"],
    paddingBlockEnd: spaceVars["--nyte-space-1"],
    borderBlockEndWidth: borderVars["--nyte-border-control-width"],
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colorVars["--nyte-color-border"],
  },
  tab: {
    height: controlVars["--nyte-control-height-md"],
    paddingInline: controlVars["--nyte-control-padding-sm"],
    borderStyle: "none",
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--nyte-color-muted"],
    },
    color: {
      default: colorVars["--nyte-color-muted-foreground"],
      "[data-active]": colorVars["--nyte-color-foreground"],
    },
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: fontVars["--nyte-font-weight-medium"],
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
  },
  indicator: {
    position: "absolute",
    insetBlockEnd: 0,
    insetInlineStart: 0,
    width: "var(--active-tab-width)",
    height: borderVars["--nyte-border-control-width"],
    backgroundColor: colorVars["--nyte-color-primary"],
    translate: "var(--active-tab-left) 0",
    transitionProperty: "translate, width",
    transitionDuration: {
      default: motionVars["--nyte-motion-normal"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  panel: {
    paddingBlockStart: controlVars["--nyte-control-padding-lg"],
    color: colorVars["--nyte-color-muted-foreground"],
    outline: "none",
  },
});

export function TabsDemo() {
  return (
    <Tabs.Root defaultValue="overview" {...stylex.props(styles.root)}>
      <Tabs.List {...stylex.props(styles.list)}>
        <Tabs.Tab value="overview" {...stylex.props(styles.tab)}>
          Overview
        </Tabs.Tab>
        <Tabs.Tab value="activity" {...stylex.props(styles.tab)}>
          Activity
        </Tabs.Tab>
        <Tabs.Indicator {...stylex.props(styles.indicator)} />
      </Tabs.List>
      <Tabs.Panel value="overview" {...stylex.props(styles.panel)}>
        Three heads, two of them running.
      </Tabs.Panel>
      <Tabs.Panel value="activity" {...stylex.props(styles.panel)}>
        Last run finished 2 minutes ago.
      </Tabs.Panel>
    </Tabs.Root>
  );
}
