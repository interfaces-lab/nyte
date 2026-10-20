import { installBridge } from "../nyte.ts";
import { createWebBridge } from "../web/bridge.ts";

installBridge({ ...createWebBridge().bridge, machineName: "Workgyver’s MacBook Pro (16-inch)" });
