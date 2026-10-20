import { parentPort, workerData } from "node:worker_threads";
import type { Static } from "typebox";
import type { PrepareRequest, prepareReply } from "./node.ts";
import { photonImages } from "./photon.ts";

const port = parentPort;

if (port === null) throw new Error("The image worker needs a parent thread");

const wasm: unknown = workerData;

if (!(wasm instanceof Uint8Array)) throw new Error("The image worker needs Photon's WebAssembly");

const images = photonImages(wasm);

port.on("message", (request: PrepareRequest) => {
  void images.prepare(request.bytes, request.mimeType, request.limits).then(
    (result) =>
      port.postMessage({
        id: request.id,
        result: result ?? null,
      } satisfies Static<typeof prepareReply>),
    (cause: unknown) =>
      port.postMessage({
        id: request.id,
        error: cause instanceof Error ? cause.message : String(cause),
      } satisfies Static<typeof prepareReply>),
  );
});
