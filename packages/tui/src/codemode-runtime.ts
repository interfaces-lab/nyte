import { loadQuickJSWasm } from "@nyte-ai/plugin/codemode-runtime";
import type { CodemodeSandboxOptions } from "@nyte-ai/plugin/codemode-runtime";
import wasmPath from "./codemode-wasm.ts";

export function codemodeRuntimeOptions(): Pick<CodemodeSandboxOptions, "workerUrl" | "wasm"> {
  const compiled =
    import.meta.url.includes("$bunfs") ||
    import.meta.url.includes("~BUN") ||
    import.meta.url.includes("%7EBUN");

  if (!compiled) return {};

  return {
    workerUrl: "./tui/src/codemode-worker.ts",
    get wasm() {
      return loadQuickJSWasm(wasmPath);
    },
  };
}
