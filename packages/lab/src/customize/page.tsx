import { applyDisplayMode } from "@nyte-ai/app/theme/appearance.ts";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Toaster } from "@nyte-ai/ui/toast";
import { props } from "@stylexjs/stylex";
import { useLayoutEffect, useState, type ReactElement } from "react";
import { boardStyles } from "../environments/environments.stylex";
import { demoStyles } from "../environments/demo.stylex";
import { customizeStyles as styles } from "./customize.stylex";
import { Detail } from "./detail";
import { INVENTORIES, type InventoryState } from "./fixtures";
import { Overview, type Layout } from "./overview";

const APPEARANCES = ["light", "dark"] as const;

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly (readonly [T, string])[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}): ReactElement {
  return (
    <Tabs.Root
      variant="segmented"
      value={value}
      onValueChange={(next: unknown) => {
        const option = options.find(([id]) => id === next);

        if (option !== undefined) onChange(option[0]);
      }}
    >
      <Tabs.List aria-label={label}>
        {options.map(([id, text]) => (
          <Tabs.Tab key={id} value={id}>
            {text}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

export function CustomizePage(): ReactElement {
  const [appearance, setAppearance] = useState<(typeof APPEARANCES)[number]>("light");
  const [state, setState] = useState<InventoryState>("configured");
  const [layout, setLayout] = useState<Layout>("cards");
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    applyDisplayMode(appearance);
  }, [appearance]);

  const inventory = INVENTORIES[state];
  const open = inventory.plugins.find((plugin) => plugin.id === openId);

  return (
    <main {...props(boardStyles.page)}>
      <header {...props(boardStyles.header)}>
        <h1 {...props(boardStyles.title)}>Customize</h1>
        <span {...props(boardStyles.subtitle)}>
          Names instead of ids, a folder one click away, and something to change on every row. Click
          a plugin card for its page.
        </span>
        <Segmented
          label="Inventory"
          options={[
            ["configured", "Configured"],
            ["fresh", "Fresh install"],
          ]}
          value={state}
          onChange={(next) => {
            setState(next);
            setOpenId(undefined);
          }}
        />
        <Segmented
          label="Layout"
          options={[
            ["cards", "Cards"],
            ["list", "List"],
          ]}
          value={layout}
          onChange={setLayout}
        />
        <Segmented
          label="Appearance"
          options={[
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
          value={appearance}
          onChange={setAppearance}
        />
      </header>
      <div {...props(demoStyles.window, styles.frame)}>
        <div {...props(styles.surface)}>
          <div {...props(styles.column)}>
            {open === undefined ? (
              <Overview
                key={state}
                layout={layout}
                inventory={inventory}
                onOpen={(plugin) => setOpenId(plugin.id)}
              />
            ) : (
              <Detail key={open.id} plugin={open} onBack={() => setOpenId(undefined)} />
            )}
          </div>
        </div>
      </div>
      <Toaster />
    </main>
  );
}
