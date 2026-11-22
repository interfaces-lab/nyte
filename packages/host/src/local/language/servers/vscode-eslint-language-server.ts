import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import type { ServerSpec } from "../spec.ts";
import { findPackage } from "./packages.ts";
import { langserversExtracted } from "./vscode-langservers-extracted.ts";

const BASE_SETTINGS = {
  validate: "probe",
  packageManager: "npm",
  useESLintClass: false,
  experimental: { useFlatConfig: false },
  codeAction: {
    disableRuleComment: { enable: true, location: "separateLine", commentStyle: "line" },
    showDocumentation: { enable: false },
  },
  codeActionOnSave: { mode: "all" },
  format: false,
  quiet: false,
  onIgnoredFiles: "off",
  options: {},
  rulesCustomizations: [],
  run: "onType",
  problems: { shortenToSingleLine: false },
  nodePath: null,
  workingDirectory: { mode: "location" },
} as const;

export const VSCODE_ESLINT_LANGUAGE_SERVER: ServerSpec = {
  name: "vscode-eslint-language-server",
  languages: ["typescript"],
  rootMarkers: [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    "eslint.config.mts",
    "eslint.config.cts",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yaml",
    ".eslintrc.yml",
  ],
  requiresRootMarker: true,
  program: "vscode-eslint-language-server",
  probe: null,
  arguments: ["--stdio"],
  install: langserversExtracted("vscode-eslint-language-server"),
  installHint: "Install the ESLint language server: npm install -g vscode-langservers-extracted",
  initializationOptions: {},
  settings: BASE_SETTINGS,
  replies: { "eslint/noConfig": {}, "eslint/noLibrary": {}, "eslint/probeFailed": null },
  async prepare(project) {
    const eslint = await findPackage(project.root, "eslint");

    const settings = {
      ...BASE_SETTINGS,
      workspaceFolder: {
        name: basename(project.root),
        uri: pathToFileURL(project.root).href,
      },
    };

    return eslint === null ? { settings } : { settings, runsOn: `ESLint ${eslint.version}` };
  },
};
