/**
 * The first import of the web entry, so the interface has its bridge before
 * `theme/boot.ts` or any screen reads it. The bridge routes nothing until
 * `connect` names a server.
 */
import { dev } from "@nyte-ai/sdk";
import { installBridge } from "../nyte.ts";
import { createWebBridge } from "./bridge.ts";

export const webBridge = createWebBridge();

installBridge(webBridge.bridge);

if (import.meta.env.DEV) {
  dev.forward("/__dev/log", "app");
  window.addEventListener("error", (event) =>
    dev("window", "error", { error: event.error, message: event.message }),
  );
  window.addEventListener("unhandledrejection", (event) =>
    dev("window", "unhandledrejection", { reason: event.reason }),
  );
}
