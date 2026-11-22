import type { Asset, ServerSpec } from "../spec.ts";

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
  requiresRootMarker: false,
  program: "ruff",
  probe: ["--version"],
  arguments: ["server"],
  install: {
    kind: "release",
    version: VERSION,
    assets: {
      "darwin-arm64": asset(
        "aarch64-apple-darwin",
        "72a886253072cd1bb6a5978a33a5a7add848ee315a8b0f1589f164a11c26328d",
      ),
      "darwin-x64": asset(
        "x86_64-apple-darwin",
        "5e554db9c2663e1b84911446cab0a9fd4aa6d9a14dc751a4869d2f92209dcb70",
      ),
      "linux-arm64": asset(
        "aarch64-unknown-linux-gnu",
        "d4eea36ee6228f6c6bbcf0aea4ebf66fe0e595eedc6cffe628d7b8ba3623390f",
      ),
      "linux-x64": asset(
        "x86_64-unknown-linux-gnu",
        "94b33791f48cd54ab35ad673a443a5c001d3e6d87effeaba9899070b700d45f3",
      ),
      "win32-arm64": asset(
        "aarch64-pc-windows-msvc",
        "fdb5146498cd30b7af288c8becab610a30aa7d300d899927347f49e99766dd85",
      ),
      "win32-x64": asset(
        "x86_64-pc-windows-msvc",
        "00c5d5793d308e8575b16b7303527110dd49bd02d46db0a8668b0eefdca14c2e",
      ),
    },
  },
  runtime: null,
  installHint: "Install Ruff: uv tool install ruff, or pip install ruff",
  initializationOptions: null,
  settings: {},
};
