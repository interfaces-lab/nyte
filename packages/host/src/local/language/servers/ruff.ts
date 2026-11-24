import type { Asset, ServerSpec } from "../spec.ts";
import { rustAssets } from "./rust-targets.ts";

const VERSION = "0.17.6";

function asset(target: string, sha256: string): Asset {
  const windows = target.endsWith("windows-msvc");

  return {
    url: `https://github.com/astral-sh/ruff/releases/download/${VERSION}/ruff-${target}.${windows ? "zip" : "tar.gz"}`,
    sha256,
    format: windows ? "zip" : "tar.gz",
    bin: windows ? "ruff.exe" : `ruff-${target}/ruff`,
  };
}

export const RUFF: ServerSpec = {
  name: "ruff",
  languages: ["python"],
  rootMarkers: ["pyproject.toml", "ruff.toml", ".ruff.toml"],
  program: "ruff",
  arguments: ["server"],
  install: {
    kind: "release",
    package: "ruff",
    version: VERSION,
    assets: rustAssets(asset, {
      "darwin-arm64": "72a886253072cd1bb6a5978a33a5a7add848ee315a8b0f1589f164a11c26328d",
      "darwin-x64": "5e554db9c2663e1b84911446cab0a9fd4aa6d9a14dc751a4869d2f92209dcb70",
      "linux-arm64": "d4eea36ee6228f6c6bbcf0aea4ebf66fe0e595eedc6cffe628d7b8ba3623390f",
      "linux-x64": "94b33791f48cd54ab35ad673a443a5c001d3e6d87effeaba9899070b700d45f3",
      "win32-arm64": "fdb5146498cd30b7af288c8becab610a30aa7d300d899927347f49e99766dd85",
      "win32-x64": "00c5d5793d308e8575b16b7303527110dd49bd02d46db0a8668b0eefdca14c2e",
    }),
  },
  installHint: "Install Ruff: uv tool install ruff, or pip install ruff",
  initializationOptions: {
    settings: {
      configurationPreference: "editorFirst",
      fixAll: true,
      organizeImports: true,
      showSyntaxErrors: true,
      lint: { enable: true },
      format: { backend: "internal" },
      codeAction: {
        disableRuleComment: { enable: true },
        fixViolation: { enable: true },
      },
    },
  },
};
