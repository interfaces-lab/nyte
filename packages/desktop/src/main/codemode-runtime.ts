import { fileURLToPath } from "node:url";
import { loadQuickJSWasm } from "@nyte-ai/plugin/codemode-runtime";
import type { CodemodeSandboxOptions } from "@nyte-ai/plugin/codemode-runtime";

export function codemodeRuntimeOptions(): Pick<CodemodeSandboxOptions, "workerUrl" | "wasm"> {
  if (import.meta.url.endsWith(".ts")) return {};

  return {
    workerUrl: new URL("./codemode-worker.js", import.meta.url),
    get wasm() {
      return loadQuickJSWasm(fileURLToPath(new URL("./quickjs.wasm", import.meta.url)));
    },
  };
}
