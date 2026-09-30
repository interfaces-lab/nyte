/**
 * The preload exposes `window.nyte` before any renderer script runs. This is
 * the first import of the entry, so the interface has its bridge before
 * `theme/boot.ts` or any screen reads it.
 */
import { installBridge } from "@nyte-ai/app/nyte.ts";
import type { DesktopBridge } from "../../shared/ipc.ts";

declare global {
  interface Window {
    readonly nyte: DesktopBridge;
  }
}

installBridge(window.nyte);
