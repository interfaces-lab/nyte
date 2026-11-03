import { installBridge } from "../src/contract/nyte.ts";
import { createWebBridge } from "../src/web/bridge.ts";
import { installScripted, scriptedConnection } from "./scripted-connection.ts";

installBridge(createWebBridge().bridge);

installScripted(scriptedConnection());
