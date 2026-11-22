import type { Asset, ServerSpec } from "../spec.ts";
import { rustAssets } from "./rust-targets.ts";

const VERSION = "0.0.107";

function asset(target: string, sha256: string): Asset {
  const windows = target.endsWith("windows-msvc");

  return {
    url: `https://github.com/astral-sh/ty/releases/download/${VERSION}/ty-${target}.${windows ? "zip" : "tar.gz"}`,
    sha256,
    format: windows ? "zip" : "tar.gz",
    bin: windows ? "ty.exe" : `ty-${target}/ty`,
  };
}

export const TY: ServerSpec = {
  name: "ty",
  languages: ["python"],
  rootMarkers: ["ty.toml", "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
  program: "ty",
  arguments: ["server"],
  install: {
    kind: "release",
    package: "ty",
    version: VERSION,
    assets: rustAssets(asset, {
      "darwin-arm64": "5b514ec3271383263250481b139c2eb59021ca674866b267f37bb988dbea52c9",
      "darwin-x64": "5bff07e2e802815a303cdb7864b7034347bebb63ad159e22a514b5555d87aae5",
      "linux-arm64": "952097983ff6b6b3235b4b5ec8077c1b8bf5c485679fd794ee70ca2007a3cf7f",
      "linux-x64": "f93e1f3e45ec81b3ce21473d541eb94470546928499415fc263f2858d65f28af",
      "win32-arm64": "e09566dd2727d8ec45d39c572040b9b6b4123ea308c1c6200a98e83c65b5c036",
      "win32-x64": "3ba361f2edda769040daffb52580d4a9a5f54f7c6040d222fd634aa70d2b9145",
    }),
  },
  installHint: "Install ty: uv tool install ty, or pip install ty",
  initializationOptions: {
    untrustedWorkspace: false,
  },
  settings: {
    ty: {
      configuration: null,
      configurationFile: null,
      disableLanguageServices: false,
      diagnosticMode: "openFilesOnly",
      showSyntaxErrors: true,
      inlayHints: {
        variableTypes: true,
        callArgumentNames: true,
      },
      completions: {
        autoImport: true,
        completeFunctionParentheses: false,
      },
    },
  },
};
