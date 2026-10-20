import type { NodeImagesOptions } from "@nyte-ai/host/images";
import { compiled } from "./compiled.ts";
import wasmPath from "./photon-wasm.ts";

export function imageRuntimeOptions(): NodeImagesOptions {
  if (!compiled) return {};

  return { worker: "./tui/src/image-worker.ts", wasm: wasmPath };
}
