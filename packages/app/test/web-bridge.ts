import { installBridge } from "../src/contract/nyte.ts";
import { installConnection } from "../src/data/connection.ts";
import { createWebBridge } from "../src/web/bridge.ts";
import { scriptedConnection } from "./scripted-connection.ts";

installBridge(createWebBridge().bridge);

installConnection(scriptedConnection().connection);
