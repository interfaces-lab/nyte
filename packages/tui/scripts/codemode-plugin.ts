import { resolveQuickJSWasmPath } from "@nyte-ai/plugin/codemode-runtime";
import type { BunPlugin } from "bun";

export const codemodePlugin = {
  name: "nyte:codemode-wasm",
  setup(build) {
    build.onLoad({ filter: /[/\\]codemode-wasm\.ts$/ }, () => ({
      contents: `import wasmPath from ${JSON.stringify(resolveQuickJSWasmPath())} with { type: "file" }; export default wasmPath;`,
      loader: "js",
    }));
  },
} satisfies BunPlugin;
