import { INSTALL_FOLDER } from "../spec.ts";
import type { ServerSpec } from "../spec.ts";

const OPTIONS = {
  usePlaceholders: false,
  completeUnimported: true,
  staticcheck: true,
  semanticTokens: true,
  hints: { parameterNames: true, constantValues: true },
  analyses: { nilness: true, unusedparams: true, unusedwrite: true, shadow: true, useany: true },
} as const;

export const GOPLS: ServerSpec = {
  name: "gopls",
  languages: ["go"],
  rootMarkers: ["go.work", "go.mod"],
  requiresRootMarker: false,
  program: "gopls",
  probe: ["version"],
  arguments: [],
  install: {
    kind: "toolchain",
    package: "gopls",
    version: "v0.24.0",
    program: "go",
    arguments: ["install", "golang.org/x/tools/gopls@v0.24.0"],
    env: { GOBIN: INSTALL_FOLDER },
    bin: "gopls",
  },
  runtime: null,
  installHint: "Install gopls: go install golang.org/x/tools/gopls@latest",
  initializationOptions: OPTIONS,
  settings: { gopls: OPTIONS },
};
