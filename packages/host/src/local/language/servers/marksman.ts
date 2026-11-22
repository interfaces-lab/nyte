import type { Asset, ServerSpec } from "../spec.ts";

const VERSION = "2026-02-08";

function asset(file: string, sha256: string, bin: string): Asset {
  return {
    url: `https://github.com/artempyanykh/marksman/releases/download/${VERSION}/${file}`,
    sha256,
    format: "file",
    bin,
  };
}

const MACOS = asset(
  "marksman-macos",
  "6a801c17b5ac0dba69787c5282b3b3bd416e66c96253fae098d311c6bbd1833b",
  "marksman",
);

export const MARKSMAN: ServerSpec = {
  name: "marksman",
  languages: ["markdown"],
  rootMarkers: [".marksman.toml", ".git"],
  requiresRootMarker: false,
  program: "marksman",
  probe: ["--version"],
  arguments: ["server"],
  install: {
    kind: "release",
    package: "marksman",
    version: VERSION,
    assets: {
      "darwin-arm64": MACOS,
      "darwin-x64": MACOS,
      "linux-arm64": asset(
        "marksman-linux-arm64",
        "db8e124527f7f8048e3e6c91821b9c52ef173d92c01e47d221bf1337afd962fb",
        "marksman",
      ),
      "linux-x64": asset(
        "marksman-linux-x64",
        "be5098e8213219269c47fc0d916a66fa31ce0602ec967475c722260aabf26087",
        "marksman",
      ),
      "win32-x64": asset(
        "marksman.exe",
        "a6d05beb08ebe41b0a9f09c98a438540421436fa5531424c22e0bb1d22529705",
        "marksman.exe",
      ),
    },
  },
  runtime: null,
  installHint:
    "Install Marksman: brew install marksman, or download a release from github.com/artempyanykh/marksman",
  initializationOptions: null,
  settings: {},
};
