import { connect } from "node:net";
import { HOST_HEADER } from "@nyte-ai/protocol";

export const SERVICE_HOSTNAME = "127.0.0.1";

export type PortHolder =
  | { readonly kind: "free" }
  | { readonly kind: "nyte"; readonly hostId: string }
  | { readonly kind: "other" };

export async function probePort(port: number, hostname = SERVICE_HOSTNAME): Promise<PortHolder> {
  const listening = await new Promise<boolean>((settle) => {
    const socket = connect({ port, host: hostname });
    socket.once("connect", () => {
      socket.destroy();
      settle(true);
    });
    socket.once("error", () => settle(false));
  });

  if (!listening) return { kind: "free" };

  const hostId = await fetch(`http://${hostname}:${String(port)}/.nyte/describe`, {
    signal: AbortSignal.timeout(1000),
  })
    .then((response) => response.headers.get(HOST_HEADER))
    .catch(() => null);

  return hostId === null ? { kind: "other" } : { kind: "nyte", hostId };
}

export function portConflict(port: number, holder: PortHolder): string | undefined {
  switch (holder.kind) {
    case "free":
      return undefined;
    case "nyte":
      return `Port ${String(port)} is in use by another Nyte host (${holder.hostId}).`;
    case "other":
      return `Port ${String(port)} is in use by another program.`;
    default: {
      const _exhaustive: never = holder;

      return _exhaustive;
    }
  }
}
