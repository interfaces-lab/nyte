import { resolvePhotonWasmPath } from "@nyte-ai/host/images";
import type { BunPlugin } from "bun";

export const photonPlugin = {
  name: "nyte:photon-wasm",
  setup(build) {
    build.onLoad({ filter: /[/\\]photon-wasm\.ts$/ }, () => ({
      contents: `import wasmPath from ${JSON.stringify(resolvePhotonWasmPath())} with { type: "file" }; export default wasmPath;`,
      loader: "js",
    }));
  },
} satisfies BunPlugin;
