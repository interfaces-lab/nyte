import { parentPort } from "node:worker_threads";
import { UsageScanner } from "./store-usage.ts";
import type { UsageWorkerReply, UsageWorkerRequest } from "./usage-scan.ts";

const port = parentPort;

if (port === null) throw new Error("The usage worker must run on a worker thread.");

let scanner: UsageScanner | undefined;

port.on("message", (request: UsageWorkerRequest) => {
  scanner ??= new UsageScanner(request.home);
  void scanner.scan(request).then(
    (scan) => {
      port.postMessage({ id: request.id, scan } satisfies UsageWorkerReply);
    },
    (cause: unknown) => {
      port.postMessage({
        id: request.id,
        error: cause instanceof Error ? cause.message : String(cause),
      } satisfies UsageWorkerReply);
    },
  );
});
