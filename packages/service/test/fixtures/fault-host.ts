import { parentPort } from "node:worker_threads";
import { fault } from "@nyte-ai/core";
import { openFaultLog } from "../../src/fault-log.ts";
import { hostFaultsPath } from "../../src/host-endpoint.ts";

const parent = parentPort;

if (parent === null) throw new Error("fault-host.ts runs as a host thread.");

fault.listen(openFaultLog(hostFaultsPath()));

parent.once("message", () => {
  parent.postMessage({ kind: "listening", address: "http://127.0.0.1:9" });
  fault("lease", "lost", { what: "main", reason: "lapsed" });
  parent.postMessage({ kind: "failed", message: "boom" });
});
