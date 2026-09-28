/**
 * The preload exposes `window.nyte` before any renderer script runs. This is
 * the first import of the entry, so the interface has its bridge before
 * `theme/boot.ts` or any screen reads it.
 */
import type { NyteBridge } from "@nyte-ai/app/bridge.ts";
import { installBridge } from "@nyte-ai/app/nyte.ts";

declare global {
  interface Window {
    readonly nyte: NyteBridge;
  }
}

installBridge(window.nyte);
