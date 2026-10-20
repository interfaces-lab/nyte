import { fileURLToPath } from "node:url";
import type { NodeImagesOptions } from "@nyte-ai/host/images";

export function imageRuntimeOptions(): NodeImagesOptions {
  if (import.meta.url.endsWith(".ts")) return {};

  return {
    worker: new URL("./image-worker.js", import.meta.url),
    wasm: fileURLToPath(new URL("./photon_rs_bg.wasm", import.meta.url)),
  };
}
