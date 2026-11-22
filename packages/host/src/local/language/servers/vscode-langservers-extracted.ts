import type { Install } from "../spec.ts";
import packages from "./vscode-langservers-extracted.lock.json" with { type: "json" };

export function langserversExtracted(program: string): Install {
  return {
    kind: "npm",
    package: "vscode-langservers-extracted",
    version: "4.10.0",
    packages,
    entry: `node_modules/vscode-langservers-extracted/bin/${program}`,
  };
}
