import { installBridge } from "../contract/nyte.ts";
import { createWebBridge } from "../web/bridge.ts";

installBridge({ ...createWebBridge().bridge, machineName: "Workgyver’s MacBook Pro (16-inch)" });
