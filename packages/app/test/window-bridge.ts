/**
 * A browser-test fixture's bridge. The test's setup script or preload puts a
 * stub on `window.nyte` before the bundle runs; importing this module first
 * hands that stub to the interface before any screen or `theme/boot.ts`
 * reads it.
 */
import type { NyteBridge } from "../src/bridge.ts";
import { installBridge } from "../src/nyte.ts";

declare global {
  interface Window {
    readonly nyte: NyteBridge;
  }
}

installBridge(window.nyte);
