import { createRequire } from "node:module";

export { loadQuickJSWasm } from "@earendil-works/pi-codemode";
export type { CodemodeSandboxOptions } from "@earendil-works/pi-codemode";

export function resolveQuickJSWasmPath(): string {
  const codemode = import.meta.resolve("@earendil-works/pi-codemode");
  return createRequire(codemode).resolve("quickjs-wasi/quickjs.wasm");
}
