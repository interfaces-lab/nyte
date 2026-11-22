import type { Asset, Install, ServerSpec } from "../spec.ts";
import packages from "./bash-language-server.lock.json" with { type: "json" };

const VERSION = "5.8.1";

const SHELLCHECK_VERSION = "0.11.0";

const SHFMT_VERSION = "3.14.1";

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

function shfmtBinary(target: string, sha256: string): Asset {
  return {
    url: `https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_${target}`,
    sha256,
    format: "file",
    bin: target.endsWith(".exe") ? "shfmt.exe" : "shfmt",
  };
}

const SHFMT: Install = {
  kind: "release",
  package: "shfmt",
  version: SHFMT_VERSION,
  assets: {
    "darwin-arm64": shfmtBinary(
      "darwin_arm64",
      "b7c872db63553ccffc7253aba3ed7d4885a27d83f1ba567b1138c6315a5847e5",
    ),
    "darwin-x64": shfmtBinary(
      "darwin_amd64",
      "d33eee0da0f92835b3562e9767a05cee7e4eaeef47daa03bfd09da17b4b590a6",
    ),
    "linux-arm64": shfmtBinary(
      "linux_arm64",
      "5f2db09dae91fca848f7adbdd014632e921a383863a2ad7e0450ad3aba0c6489",
    ),
    "linux-x64": shfmtBinary(
      "linux_amd64",
      "76e77641faa025814b77f153b29796b8e6fa2fca03e0c76a691608b86c7ea7bf",
    ),
    "win32-x64": shfmtBinary(
      "windows_amd64.exe",
      "13629ce28442ca80b6b5a819f7574ab39e1c28c6e26734ca816c9714e04851df",
    ),
  },
};

export const BASH_LANGUAGE_SERVER: ServerSpec = {
  name: "bash-language-server",
  languages: ["bash"],
  rootMarkers: [".shellcheckrc", ".git"],
  program: "bash-language-server",
  arguments: ["start"],
  install: {
    kind: "npm",
    package: "bash-language-server",
    version: VERSION,
    packages,
    entry: "node_modules/bash-language-server/out/cli.js",
  },
  installHint: "Install the Bash language server: npm install -g bash-language-server",
  settings: { bashIde: SETTINGS },
  async prepare(project) {
    const shellcheck = await project.tool("shellcheck", ["--version"], SHELLCHECK);
    const shfmt = await project.tool("shfmt", ["--version"], SHFMT);

    const settings = {
      bashIde: {
        ...SETTINGS,
        shellcheckPath: shellcheck?.path ?? "",
        shfmt: { ...SETTINGS.shfmt, path: shfmt?.path ?? "" },
      },
    };

    const pinned = [
      shellcheck?.pinned === true ? `ShellCheck ${SHELLCHECK_VERSION}` : null,
      shfmt?.pinned === true ? `shfmt ${SHFMT_VERSION}` : null,
    ].filter((part) => part !== null);

    return pinned.length === 0 ? { settings } : { settings, runsOn: pinned.join(", ") };
  },
};
