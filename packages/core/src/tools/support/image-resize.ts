import { Worker } from "node:worker_threads";
import {
  type ImageResizeOptions,
  type ResizedImage,
  resizeImageInProcess,
} from "./image-resize-core.ts";
import { checkResizeResponse, type ResizeRequest } from "./image-resize-messages.ts";

export type { ImageResizeOptions, ResizedImage } from "./image-resize-core.ts";

function toTransferableBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  // Transfer detaches the buffer, so transfer a worker-owned copy and leave the
  // caller's bytes intact.
  return new Uint8Array(input);
}

function createResizeWorker(workerSpecifier: string | URL): Worker {
  return new Worker(workerSpecifier);
}

async function resizeImageInWorker(
  workerSpecifier: string | URL,
  inputBytes: Uint8Array,
  mimeType: string,
  options?: ImageResizeOptions,
): Promise<ResizedImage | null> {
  const worker = createResizeWorker(workerSpecifier);
  try {
    const inputBytesForWorker = toTransferableBytes(inputBytes);
    return await new Promise<ResizedImage | null>((resolve, reject) => {
      let settled = false;
      const settle = (result: ResizedImage | null): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      worker.once("message", (message) => {
        if (!checkResizeResponse.Check(message)) {
          fail(new Error("Invalid image resize worker response"));
          return;
        }
        if ("error" in message) {
          fail(new Error(message.error));
          return;
        }
        settle(message.result);
      });
      worker.once("error", fail);
      worker.once("exit", (code) => {
        if (!settled) {
          fail(new Error(`Image resize worker exited with code ${code}`));
        }
      });
      const request: ResizeRequest = { inputBytes: inputBytesForWorker, mimeType, options };
      worker.postMessage(request, [inputBytesForWorker.buffer]);
    });
  } finally {
    void worker.terminate().catch(() => undefined);
  }
}

/**
 * Resize an image to fit within the specified max dimensions and encoded file size.
 * Runs Photon in a worker thread so WASM decoding, resizing, and encoding do not
 * block the TUI event loop. If the worker cannot be loaded (for example in some
 * Bun compiled executable layouts), fall back to in-process resizing so image
 * reads still work.
 */
export async function resizeImage(
  inputBytes: Uint8Array,
  mimeType: string,
  options?: ImageResizeOptions,
): Promise<ResizedImage | null> {
  const isTypeScriptRuntime = import.meta.url.endsWith(".ts");
  const workerUrl = new URL(
    isTypeScriptRuntime ? "./image-resize-worker.ts" : "./image-resize-worker.js",
    import.meta.url,
  );

  // Bun compiled executables resolve worker entrypoints by string path, not via
  // new URL(..., import.meta.url). Try the string path first under Bun so the
  // release binary uses the embedded worker instead of falling back in-process.
  if (process.versions.bun !== undefined) {
    try {
      return await resizeImageInWorker(
        "/$bunfs/root/core/src/tools/support/image-resize-worker.js",
        inputBytes,
        mimeType,
        options,
      );
    } catch {}
  }

  try {
    return await resizeImageInWorker(workerUrl, inputBytes, mimeType, options);
  } catch {
    return resizeImageInProcess(inputBytes, mimeType, options);
  }
}
