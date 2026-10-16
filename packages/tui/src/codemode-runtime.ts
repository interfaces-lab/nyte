import { loadQuickJSWasm } from "@nyte-ai/plugin/core/codemode-runtime";
import type { CodemodeSandboxOptions } from "@nyte-ai/plugin/core/codemode-runtime";
import wasmPath from "./codemode-wasm.ts";

export const compiled =
  import.meta.url.includes("$bunfs") ||
  import.meta.url.includes("~BUN") ||
  import.meta.url.includes("%7EBUN");

export function codemodeRuntimeOptions(): Pick<CodemodeSandboxOptions, "workerUrl" | "wasm"> {
  if (!compiled) return {};

  return {
    workerUrl: "./tui/src/codemode-worker.ts",
    get wasm() {
      return loadQuickJSWasm(wasmPath);
    },
  };
}
