import { parentPort } from "node:worker_threads";
import {
  type ImageResizeOptions,
  type ResizedImage,
  resizeImageInProcess,
} from "./image-resize-core.ts";

interface ResizeImageWorkerRequest {
  inputBytes: Uint8Array;
  mimeType: string;
  options?: ImageResizeOptions;
}

interface ResizeImageWorkerResponse {
  result?: ResizedImage | null;
  error?: string;
}

function isResizeImageWorkerRequest(value: unknown): value is ResizeImageWorkerRequest {
  if (!value || typeof value !== "object") return false;
  if (
    !("inputBytes" in value) ||
    !(value.inputBytes instanceof Uint8Array) ||
    !("mimeType" in value) ||
    typeof value.mimeType !== "string"
  )
    return false;
  if (!("options" in value) || value.options === undefined) return true;
  const options = value.options;
  if (options === null || typeof options !== "object") return false;
  return (
    (!("maxWidth" in options) ||
      options.maxWidth === undefined ||
      typeof options.maxWidth === "number") &&
    (!("maxHeight" in options) ||
      options.maxHeight === undefined ||
      typeof options.maxHeight === "number") &&
    (!("maxBytes" in options) ||
      options.maxBytes === undefined ||
      typeof options.maxBytes === "number") &&
    (!("jpegQuality" in options) ||
      options.jpegQuality === undefined ||
      typeof options.jpegQuality === "number")
  );
}

const port = parentPort;
if (!port) {
  throw new Error("image resize worker requires parentPort");
}

port.once("message", (message: unknown) => {
  void (async () => {
    try {
      if (!isResizeImageWorkerRequest(message)) {
        throw new Error("Invalid image resize worker request");
      }
      const result = await resizeImageInProcess(
        message.inputBytes,
        message.mimeType,
        message.options,
      );
      const response: ResizeImageWorkerResponse = { result };
      port.postMessage(response);
    } catch (error) {
      const response: ResizeImageWorkerResponse = {
        error: error instanceof Error ? error.message : String(error),
      };
      port.postMessage(response);
    }
  })();
});
