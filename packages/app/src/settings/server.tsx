import type { ReactElement } from "react";
import { RemoteHost } from "../environments/cloud-connection.tsx";
import { HostProcessSection } from "../environments/host-process.tsx";
import { RemoteAccess, useWindowFocused } from "../environments/server-settings.tsx";
import { preferences } from "../preferences/index.ts";
import { SettingsSection, SwitchRow } from "../settings-rows/rows.tsx";

export function ServerSettings(): ReactElement {
  const active = useWindowFocused();

  return (
    <>
      <HostProcessSection />
      <RemoteAccess active={active} />
      <SettingsSection>
        <SwitchRow
          setting={preferences.remoteControl}
          title="Remote control"
          description="Let your other devices run this app's actions and change its settings"
        />
      </SettingsSection>
      <RemoteHost />
    </>
  );
}
