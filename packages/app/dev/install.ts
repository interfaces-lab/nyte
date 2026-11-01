import { installBridge } from "../src/contract/nyte.ts";
import { createWebBridge } from "../src/web/bridge.ts";

installBridge({ ...createWebBridge().bridge, machineName: "Workgyver’s MacBook Pro (16-inch)" });
