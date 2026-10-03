/**
 * Worker entry for the usage scan. One scanner per worker, so its caches are
 * loaded once and reused across every read the main process sends.
 */
import { parentPort } from "node:worker_threads";
import { UsageScanner } from "@nyte-ai/host/store-usage";
import type { UsageWorkerReply, UsageWorkerRequest } from "./usage-scan.ts";

const port = parentPort;

if (port === null) throw new Error("The usage worker must run on a worker thread.");

let scanner: UsageScanner | undefined;

port.on("message", (request: UsageWorkerRequest) => {
  scanner ??= new UsageScanner(request.home);
  void scanner.scan(request).then((scan) => {
    port.postMessage({ id: request.id, scan } satisfies UsageWorkerReply);
  });
});
