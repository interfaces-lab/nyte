import type { ReactElement } from "react";
import { RemoteHost } from "../chrome/cloud-connection.tsx";
import { RemoteAccess, useWindowFocused } from "../chrome/server-settings.tsx";

export function ServerSettings(): ReactElement {
  const active = useWindowFocused();

  return (
    <>
      <RemoteAccess active={active} />
      <RemoteHost />
    </>
  );
}
