/**
 * Worker entry for the usage scan. One scanner per worker, so its caches are
 * loaded once and reused across every read the main process sends.
 */
import { parentPort } from "node:worker_threads";
import { UsageScanner, type UsageWorkerReply, type UsageWorkerRequest } from "./usage-scan.ts";

function isRequest(value: unknown): value is UsageWorkerRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "home" in value &&
    typeof value.home === "string" &&
    "stores" in value &&
    Array.isArray(value.stores) &&
    "catalog" in value &&
    Array.isArray(value.catalog)
  );
}

const port = parentPort;

if (port === null) throw new Error("The usage worker must run on a worker thread.");

let scanner: UsageScanner | undefined;

port.on("message", (value: unknown) => {
  if (!isRequest(value)) return;
  scanner ??= new UsageScanner(value.home);
  void scanner.scan(value).then((scan) => {
    port.postMessage({ id: value.id, scan } satisfies UsageWorkerReply);
  });
});
