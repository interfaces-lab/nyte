import { installBridge } from "../src/nyte.ts";
import { createWebBridge } from "../src/web/bridge.ts";

installBridge(createWebBridge().bridge);
