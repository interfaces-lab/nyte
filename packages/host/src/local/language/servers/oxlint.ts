import type { ServerSpec } from "../spec.ts";

export const OXLINT: ServerSpec = {
  name: "oxlint",
  languages: ["typescript"],
  rootMarkers: [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"],
  requiresRootMarker: true,
  program: "oxlint",
  arguments: ["--lsp"],
  installHint: "Install oxlint in the project: npm install --save-dev oxlint",
};
