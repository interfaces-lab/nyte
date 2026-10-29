import type { NyteBridge } from "../src/contract/bridge.ts";
import { installBridge } from "../src/contract/nyte.ts";

declare global {
  interface Window {
    readonly nyte: NyteBridge;
  }
}

installBridge(window.nyte);
