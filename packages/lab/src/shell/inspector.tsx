import { create, props } from "@stylexjs/stylex";
import { DialRoot, DialStore } from "dialkit";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Tabs } from "@nyte-ai/ui/tabs";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { useScheme } from "./scheme.ts";
import { TokenOverrides } from "./tokens.tsx";

const PANES = ["controls", "tokens"] as const;

const styles = create({
  root: { display: "flex", flexDirection: "column", minHeight: 0, flex: 1 },
  tabs: { flexShrink: 0, paddingInline: space.s3, paddingBlockStart: space.s3 },
  pane: { flex: 1, minHeight: 0, overflowY: "auto", padding: space.s3 },
  empty: { margin: 0, color: role.contentTertiary },
});

/** The prototype's dials and the lab's token overrides, beside the stage. */
export function Inspector(): ReactElement {
  const [pane, setPane] = useState<(typeof PANES)[number]>("controls");

  return (
    <Tabs.Root
      variant="segmented"
      value={pane}
      xstyle={styles.root}
      onValueChange={(value) => {
        const next = PANES.find((entry) => entry === value);

        if (next !== undefined) setPane(next);
      }}
    >
      <Tabs.List aria-label="Inspector" xstyle={styles.tabs}>
        <Tabs.Tab value="controls">Controls</Tabs.Tab>
        <Tabs.Tab value="tokens">Tokens</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="controls" data-nyte-scrollport="" xstyle={styles.pane}>
        <Controls />
      </Tabs.Panel>
      <Tabs.Panel value="tokens" data-nyte-scrollport="" xstyle={styles.pane}>
        <TokenOverrides />
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function Controls(): ReactElement {
  const scheme = useScheme();

  const panels = useSyncExternalStore(
    (onChange) => DialStore.subscribeGlobal(onChange),
    () => DialStore.getPanels("panel").length,
  );

  if (panels === 0) return <p {...props(text.sm, styles.empty)}>This prototype has no dials.</p>;

  return (
    <div data-lab-dials="">
      <DialRoot mode="inline" theme={scheme} productionEnabled />
    </div>
  );
}
