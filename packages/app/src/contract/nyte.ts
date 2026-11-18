import type { NyteBridge } from "./bridge.ts";
import type { DesktopApp } from "./desktop-app.ts";

let installed: NyteBridge | undefined;

function bridge(): NyteBridge {
  if (installed === undefined) throw new Error("No Nyte bridge is installed");

  return installed;
}

export function installBridge(value: NyteBridge): void {
  installed = value;
}

/** The app this window is, read before or without a bridge as Nyte. */
export function windowApp(): DesktopApp {
  return installed?.app ?? "nyte";
}

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
  get host() {
    return bridge().host;
  },
};

export type { HostState, UsageReport, UsageTotals, UsageWindow } from "./bridge.ts";
