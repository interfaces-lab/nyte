import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Install, ServerSpec } from "../spec.ts";
import packages from "./vscode-langservers-extracted.lock.json" with { type: "json" };

const PackageManifest = compile(Type.Object({ version: Type.String() }));

const BASE_SETTINGS = {
  validate: "probe",
  packageManager: "npm",
  useESLintClass: false,
  experimental: { useFlatConfig: false },
  codeAction: {
    disableRuleComment: { enable: true, location: "separateLine", commentStyle: "line" },
    showDocumentation: { enable: true },
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

const INSTALL: Install = {
  kind: "npm",
  package: "vscode-langservers-extracted",
  version: "4.10.0",
  packages,
  entry: "node_modules/vscode-langservers-extracted/bin/vscode-eslint-language-server",
};

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
  install: INSTALL,
  runtime: null,
  installHint: "Install the ESLint language server: npm install -g vscode-langservers-extracted",
  initializationOptions: {},
  settings: BASE_SETTINGS,
  async prepare(project) {
    const eslint = await findUpward(project.root, join("node_modules", "eslint"));

    const manifest =
      eslint === null
        ? null
        : await readFile(join(eslint, "package.json"), "utf8").catch(() => null);

    const version = manifest === null ? null : readPackageVersion(manifest);

    const settings = {
      ...BASE_SETTINGS,
      workspaceFolder: {
        name: basename(project.root),
        uri: pathToFileURL(project.root).href,
      },
    };

    return version === null ? { settings } : { settings, runsOn: `ESLint ${version}` };
  },
};

async function findUpward(from: string, name: string): Promise<string | null> {
  const candidate = join(from, name);

  if ((await stat(candidate).catch(() => null)) !== null) return candidate;
  const parent = dirname(from);

  return parent === from ? null : findUpward(parent, name);
}

function readPackageVersion(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);

    return PackageManifest.Check(value) ? value.version : null;
  } catch {
    return null;
  }
}
