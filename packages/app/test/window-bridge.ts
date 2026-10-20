import type { NyteBridge } from "../src/bridge.ts";
import { installBridge } from "../src/nyte.ts";

declare global {
  interface Window {
    readonly nyte: NyteBridge;
  }
}

installBridge(window.nyte);
