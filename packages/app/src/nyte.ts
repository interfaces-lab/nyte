import type { NyteBridge } from "./bridge.ts";

let installed: NyteBridge | undefined;

function bridge(): NyteBridge {
  if (installed === undefined) throw new Error("No Nyte bridge is installed");

  return installed;
}

/** Called once by the host's entry before anything reads `nyte`. */
export function installBridge(value: NyteBridge): void {
  installed = value;
}

/** Every read goes through the installed bridge, so importing this module binds nothing. */
export const nyte: NyteBridge = {
  get clientSurface() {
    return bridge().clientSurface;
  },
  get platform() {
    return bridge().platform;
  },
  get machineName() {
    return bridge().machineName;
  },
  get canvasShell() {
    return bridge().canvasShell;
  },
  get relay() {
    return bridge().relay;
  },
  get host() {
    return bridge().host;
  },
};

export type { HostState, UsageReport, UsageTotals, UsageWindow } from "./bridge.ts";
