/**
 * The first import of the web entry, so the interface has its bridge before
 * `theme/boot.ts` or any screen reads it. The bridge routes nothing until
 * `connect` names a server.
 */
import { installBridge } from "../nyte.ts";
import { createWebBridge } from "./bridge.ts";

export const webBridge = createWebBridge();

installBridge(webBridge.bridge);
