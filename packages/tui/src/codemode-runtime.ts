import { loadQuickJSWasm } from "@nyte-ai/plugin/core/codemode-runtime";
import type { CodemodeSandboxOptions } from "@nyte-ai/plugin/core/codemode-runtime";
import wasmPath from "./codemode-wasm.ts";
import { compiled } from "./compiled.ts";

export function codemodeRuntimeOptions(): Pick<CodemodeSandboxOptions, "workerUrl" | "wasm"> {
  if (!compiled) return {};

  return {
    workerUrl: "./tui/src/codemode-worker.ts",
    get wasm() {
      return loadQuickJSWasm(wasmPath);
    },
  };
}
