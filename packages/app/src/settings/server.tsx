import type { ReactElement } from "react";
import { RemoteHost } from "../environments/cloud-connection.tsx";
import { HostProcessSection } from "../environments/host-process.tsx";
import { RemoteAccess, useWindowFocused } from "../environments/server-settings.tsx";

export function ServerSettings(): ReactElement {
  const active = useWindowFocused();

  return (
    <>
      <HostProcessSection />
      <RemoteAccess active={active} />
      <RemoteHost />
    </>
  );
}
