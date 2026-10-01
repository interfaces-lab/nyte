/**
 * Environments: where chats run. It opens over the stage the way Customize
 * does, in Customize's column and tabs. Connections are the places this app
 * sends chats to: This Mac and the Cloud server. Remote access is the reverse,
 * other devices sending chats to this Mac.
 */
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { Tabs } from "@nyte-ai/ui/tabs";
import { useServerState } from "../queries.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { customizeStyles as styles } from "./customize.stylex.ts";
import { CloudConnection, RemoteAccess, useWindowFocused } from "./server-settings.tsx";
import { useChromeTab } from "./use-chrome-tab.ts";
import { isOption } from "./sidebar-view.ts";

const ENVIRONMENT_TABS = [
  ["connections", "Connections"],
  ["remote", "Remote Access"],
] as const;

const ENVIRONMENT_TAB_IDS = ["connections", "remote"] as const;

export function EnvironmentsSurface(): ReactElement {
  const [tab, setTab] = useChromeTab("environment", ENVIRONMENT_TAB_IDS);
  const active = useWindowFocused();
  const server = useServerState(active);
  const connections = server.data === undefined || server.data.kind === "none" ? 1 : 2;

  return (
    <div {...props(styles.surface)}>
      <Tabs.Root
        variant="pill"
        value={tab}
        xstyle={styles.root}
        onValueChange={(value) => {
          if (isOption(value, ENVIRONMENT_TAB_IDS)) setTab(value);
        }}
      >
        <Tabs.List aria-label="Environments">
          {ENVIRONMENT_TABS.map(([id, label]) => (
            <Tabs.Tab key={id} value={id}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="connections" render={<section />} xstyle={styles.inventory}>
          <div {...props(styles.inventoryHeading)}>
            <h1 {...props(styles.inventoryTitle)}>Connected</h1>
            <span {...props(styles.inventoryCount)}>{connections}</span>
          </div>
          <ConnectionList>
            <ConnectionRow
              glyph={<Icon name="computer" size={16} />}
              title="This Mac"
              detail={undefined}
              status={<ConnectionStatus tone="on">This device</ConnectionStatus>}
            />
            <CloudConnection active={active} />
          </ConnectionList>
        </Tabs.Panel>

        <Tabs.Panel value="remote" render={<section />} xstyle={styles.inventory}>
          <div {...props(styles.inventoryHeading)}>
            <h1 {...props(styles.inventoryTitle)}>Serving this Mac</h1>
          </div>
          <RemoteAccess active={active} />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}
