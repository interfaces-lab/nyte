"use client";

import { Tabs } from "@nyte-ai/ui/tabs";
import { t } from "@nyte-ai/ui/vars.stylex";
import { create } from "@stylexjs/stylex";

const styles = create({
  root: { display: "flex", flexDirection: "column", gap: 12, width: 320 },
  panel: {
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
});

export function TabsDemo() {
  return (
    <Tabs.Root defaultValue="overview" xstyle={styles.root}>
      <Tabs.List aria-label="Session">
        <Tabs.Tab value="overview">Overview</Tabs.Tab>
        <Tabs.Tab value="activity">Activity</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="overview" xstyle={styles.panel}>
        Three heads, two of them running.
      </Tabs.Panel>
      <Tabs.Panel value="activity" xstyle={styles.panel}>
        Last run finished 2 minutes ago.
      </Tabs.Panel>
    </Tabs.Root>
  );
}

export function TabsSegmentedDemo() {
  return (
    <Tabs.Root variant="segmented" defaultValue="spend" xstyle={styles.root}>
      <Tabs.List aria-label="Usage">
        <Tabs.Tab value="spend">Spend</Tabs.Tab>
        <Tabs.Tab value="limits">Limits</Tabs.Tab>
        <Tabs.Tab value="tools">All tools</Tabs.Tab>
      </Tabs.List>
    </Tabs.Root>
  );
}

export function TabsUnderlineDemo() {
  return (
    <Tabs.Root variant="underline" defaultValue="models" xstyle={styles.root}>
      <Tabs.List aria-label="Breakdown">
        <Tabs.Tab value="models">Models</Tabs.Tab>
        <Tabs.Tab value="tools">Tools</Tabs.Tab>
        <Tabs.Tab value="folders">Folders</Tabs.Tab>
      </Tabs.List>
    </Tabs.Root>
  );
}

export function TabsPillDemo() {
  return (
    <Tabs.Root variant="pill" defaultValue="plugins" xstyle={styles.root}>
      <Tabs.List aria-label="Inventory">
        <Tabs.Tab value="plugins">Plugins</Tabs.Tab>
        <Tabs.Tab value="skills">Skills</Tabs.Tab>
        <Tabs.Tab value="settings">Settings</Tabs.Tab>
      </Tabs.List>
    </Tabs.Root>
  );
}
