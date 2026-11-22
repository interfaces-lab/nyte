import { findExecutable } from "../../process/command.ts";
import type { Asset, Install, ServerSpec } from "../spec.ts";
import packages from "./bash-language-server.lock.json" with { type: "json" };

const VERSION = "5.8.1";

const SHELLCHECK_VERSION = "0.11.0";

const SETTINGS = {
  backgroundAnalysisMaxFiles: 500,
  backgroundAnalysisIgnore: ["**/node_modules/**", "**/.git/**"],
  enableSourceErrorDiagnostics: false,
  explainshellEndpoint: "",
  globPattern: "**/*@(.sh|.inc|.bash|.command)",
  includeAllWorkspaceSymbols: false,
  logLevel: "info",
  shellcheckPath: "shellcheck",
  shellcheckExternalSources: true,
  shellcheckArguments: "",
  shfmt: {
    path: "shfmt",
    additionalArguments: [],
    ignoreEditorconfig: false,
    languageDialect: "auto",
    binaryNextLine: false,
    caseIndent: false,
    funcNextLine: false,
    keepPadding: false,
    simplifyCode: false,
    spaceRedirects: false,
  },
} as const;

function shellcheckArchive(target: string, sha256: string): Asset {
  return {
    url: `https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.${target}.tar.gz`,
    sha256,
    format: "tar.gz",
    bin: `shellcheck-v${SHELLCHECK_VERSION}/shellcheck`,
  };
}

const SHELLCHECK: Install = {
  kind: "release",
  package: "shellcheck",
  version: SHELLCHECK_VERSION,
  assets: {
    "darwin-arm64": shellcheckArchive(
      "darwin.aarch64",
      "339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f",
    ),
    "darwin-x64": shellcheckArchive(
      "darwin.x86_64",
      "c2c15e08df0e8fbc374c335b230a7ee958c313fa5714817a59aa59f1aa594f51",
    ),
    "linux-arm64": shellcheckArchive(
      "linux.aarch64",
      "68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc",
    ),
    "linux-x64": shellcheckArchive(
      "linux.x86_64",
      "b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6",
    ),
    "win32-x64": {
      url: `https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.zip`,
      sha256: "8a4e35ab0b331c85d73567b12f2a444df187f483e5079ceffa6bda1faa2e740e",
      format: "zip",
      bin: "shellcheck.exe",
    },
  },
};

export const BASH_LANGUAGE_SERVER: ServerSpec = {
  name: "bash-language-server",
  languages: ["bash"],
  rootMarkers: [".shellcheckrc", ".git"],
  requiresRootMarker: false,
  program: "bash-language-server",
  probe: ["--version"],
  arguments: ["start"],
  install: {
    kind: "npm",
    package: "bash-language-server",
    version: VERSION,
    packages,
    entry: "node_modules/bash-language-server/out/cli.js",
  },
  runtime: null,
  installHint: "Install the Bash language server: npm install -g bash-language-server",
  initializationOptions: null,
  settings: { bashIde: SETTINGS },
  async prepare(project) {
    const found = await findExecutable("shellcheck");
    const installed = found === null ? await project.install(SHELLCHECK) : null;
    const shellcheck = found ?? installed?.path ?? null;

    if (shellcheck === null) return {};

    const settings = { bashIde: { ...SETTINGS, shellcheckPath: shellcheck } };

    if (installed === null) return { settings };

    return { settings, runsOn: `ShellCheck ${SHELLCHECK_VERSION}` };
  },
};
