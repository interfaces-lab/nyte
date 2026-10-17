import { installBridge } from "../src/nyte.ts";
import { installConnection } from "../src/sdk.tsx";
import { createWebBridge } from "../src/web/bridge.ts";
import { scriptedConnection } from "./scripted-connection.ts";

installBridge(createWebBridge().bridge);

installConnection(scriptedConnection().connection);
