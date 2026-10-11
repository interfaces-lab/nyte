import { createRequire } from "node:module";

export { loadQuickJSWasm } from "@earendil-works/pi-codemode";
export type { CodemodeSandboxOptions } from "@earendil-works/pi-codemode";

/**
 * Returns the path of the QuickJS wasm the codemode sandbox loads, for a
 * bundler that copies it next to its output. Node only: it resolves through
 * `node:module`.
 *
 * @category plugins
 * @since 0.1.0
 */
export function resolveQuickJSWasmPath(): string {
  return createRequire(import.meta.resolve("@earendil-works/pi-codemode")).resolve("quickjs-wasi/quickjs.wasm");
}
