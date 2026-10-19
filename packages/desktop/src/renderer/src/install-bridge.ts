/**
 * The preload exposes `window.nyte` before any renderer script runs. This is
 * the first import of the entry, so the interface has its bridge before
 * `theme/boot.ts` or any screen reads it.
 */
import { installBridge } from "@nyte-ai/app/nyte.ts";
import { messagePortEnd, portFetch } from "../../shared/host-port.ts";
import type { PortEnd } from "../../shared/host-port.ts";
import { HOST_PORT_CHANNEL } from "../../shared/ipc.ts";
import type { DesktopBridge } from "../../shared/ipc.ts";

declare global {
  interface Window {
    readonly nyte: DesktopBridge;
  }
}

/** A port main answers the nonce with; the preload hands it over as a window message, since ports can't cross the context bridge. */
function openHostPort(): Promise<PortEnd> {
  const nonce = crypto.randomUUID();
  const answered = Promise.withResolvers<PortEnd>();

  const receive = (event: MessageEvent): void => {
    const { data } = event;

    if (
      event.source !== window ||
      typeof data !== "object" ||
      data === null ||
      !("channel" in data && data.channel === HOST_PORT_CHANNEL) ||
      !("nonce" in data && data.nonce === nonce)
    )
      return;
    window.removeEventListener("message", receive);
    const [port] = event.ports;

    if (port === undefined) answered.reject(new Error("The Nyte host stopped."));
    else answered.resolve(messagePortEnd(port));
  };

  window.addEventListener("message", receive);
  window.nyte.host.openPort(nonce);

  return answered.promise;
}

installBridge({ ...window.nyte, host: { ...window.nyte.host, fetch: portFetch(openHostPort) } });
