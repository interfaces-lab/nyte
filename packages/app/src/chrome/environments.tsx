/**
 * Environments: where chats run. It opens over the stage the way Customize
 * does, in Customize's column. The Server is the place this app sends chats
 * to; remote access is the reverse, other devices sending chats to this Mac.
 */
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionList } from "./connection-list.tsx";
import { customizeStyles as styles } from "./customize.stylex.ts";
import { CloudConnection, RemoteAccess, useWindowFocused } from "./server-settings.tsx";

export function EnvironmentsSurface(): ReactElement {
  const active = useWindowFocused();

  return (
    <div {...props(styles.surface)}>
      <div {...props(styles.root)}>
        <section {...props(settingsPatterns.section)}>
          <div {...props(settingsPatterns.sectionHeader)}>
            <h2 {...props(settingsPatterns.sectionTitle)}>Server</h2>
          </div>
          <ConnectionList>
            <CloudConnection active={active} />
          </ConnectionList>
        </section>
        <section {...props(settingsPatterns.section)}>
          <div {...props(settingsPatterns.sectionHeader)}>
            <h2 {...props(settingsPatterns.sectionTitle)}>Remote access</h2>
          </div>
          <RemoteAccess active={active} />
        </section>
      </div>
    </div>
  );
}
