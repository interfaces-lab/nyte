import type { ServerSpec } from "../spec.ts";

export const OXLINT: ServerSpec = {
  name: "oxlint",
  languages: ["typescript"],
  rootMarkers: [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"],
  requiresRootMarker: true,
  program: "oxlint",
  probe: ["--version"],
  arguments: ["--lsp"],
  install: null,
  runtime: null,
  installHint: "Install oxlint in the project: npm install --save-dev oxlint",
  initializationOptions: null,
  settings: {},
};
