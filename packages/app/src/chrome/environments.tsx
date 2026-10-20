import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionList } from "./connection-list.tsx";
import { settingsStyles as page } from "../settings/settings.stylex.ts";
import { CloudConnection } from "./cloud-connection.tsx";
import { RemoteAccess, useWindowFocused } from "./server-settings.tsx";

export function EnvironmentsSurface(): ReactElement {
  const active = useWindowFocused();

  return (
    <div {...props(page.content)}>
      <div {...props(page.contentInner)}>
        <section {...props(settingsPatterns.section)}>
          <div {...props(settingsPatterns.sectionHeader)}>
            <h2 {...props(settingsPatterns.sectionTitle)}>Remote access</h2>
          </div>
          <RemoteAccess active={active} />
        </section>
        <section {...props(settingsPatterns.section)}>
          <div {...props(settingsPatterns.sectionHeader)}>
            <h2 {...props(settingsPatterns.sectionTitle)}>Server</h2>
          </div>
          <ConnectionList>
            <CloudConnection active={active} />
          </ConnectionList>
        </section>
      </div>
    </div>
  );
}
