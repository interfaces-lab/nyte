import { installBridge } from "@nyte-ai/app/nyte.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { messagePortEnd, portFetch } from "../../shared/host-port.ts";
import type { PortEnd } from "../../shared/host-port.ts";
import { HOST_PORT_CHANNEL } from "../../shared/ipc.ts";
import type { DesktopBridge } from "../../shared/ipc.ts";

declare global {
  interface Window {
    readonly nyte: DesktopBridge;
  }
}

const HostPortAnswer = Type.Object({
  channel: Type.Literal(HOST_PORT_CHANNEL),
  nonce: Type.String(),
});

function openHostPort(): Promise<PortEnd> {
  const nonce = crypto.randomUUID();
  const answered = Promise.withResolvers<PortEnd>();

  const receive = (event: MessageEvent): void => {
    if (
      event.source !== window ||
      !Value.Check(HostPortAnswer, event.data) ||
      event.data.nonce !== nonce
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
