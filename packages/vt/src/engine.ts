import { readKeys, readLayout } from "./layout.ts";
import { parseManifest } from "./manifest.ts";
import { requireNative, checkExports } from "./native.ts";
import { encodeTrampolines } from "./trampoline.ts";

import type { Engine } from "./index.ts";

export async function loadEngine(bytes: BufferSource): Promise<Engine> {
  const module = await WebAssembly.compile(bytes);

  checkExports(module);

  const instance = await WebAssembly.instantiate(module, {});
  const native = instance.exports;

  requireNative(native);
  const json = native.ghostty_type_json();
  const memory = new Uint8Array(native.memory.buffer);

  const manifest = parseManifest(
    new TextDecoder().decode(memory.subarray(json, memory.indexOf(0, json))),
  );

  return {
    module,
    layout: readLayout(manifest),
    keys: readKeys(manifest),
    trampolines: await WebAssembly.compile(encodeTrampolines()),
  };
}
