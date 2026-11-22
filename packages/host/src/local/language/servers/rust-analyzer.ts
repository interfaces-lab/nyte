import type { Asset, ServerSpec } from "../spec.ts";

const VERSION = "2026-11-16";

const OPTIONS = {
  cargo: {
    allTargets: true,
    autoreload: true,
    buildScripts: { enable: true, rebuildOnSave: true },
  },
  checkOnSave: true,
  check: { command: "check", workspace: true },
  completion: {
    autoimport: { enable: true },
    callable: { snippets: "fill_arguments" },
    postfix: { enable: true },
  },
  diagnostics: { enable: true },
  files: { watcher: "client" },
  inlayHints: {
    chainingHints: { enable: true },
    closingBraceHints: { enable: true, minLines: 25 },
    parameterHints: { enable: true },
    typeHints: { enable: true },
  },
  procMacro: { enable: true, attributes: { enable: true } },
  semanticHighlighting: { nonStandardTokens: true },
} as const;

function asset(target: string, sha256: string): Asset {
  const windows = target.endsWith("windows-msvc");

  return {
    url: `https://github.com/rust-lang/rust-analyzer/releases/download/${VERSION}/rust-analyzer-${target}.${windows ? "zip" : "gz"}`,
    sha256,
    format: windows ? "zip" : "gz",
    bin: windows ? "rust-analyzer.exe" : "rust-analyzer",
  };
}

export const RUST_ANALYZER: ServerSpec = {
  name: "rust-analyzer",
  languages: ["rust"],
  rootMarkers: ["Cargo.toml", "rust-project.json"],
  requiresRootMarker: false,
  program: "rust-analyzer",
  arguments: [],
  install: {
    kind: "release",
    version: VERSION,
    assets: {
      "darwin-arm64": asset(
        "aarch64-apple-darwin",
        "608b7c7d6bec1fcd6c964578b1f8234888afe6d6c0e7915284f1e2fd36ef1343",
      ),
      "darwin-x64": asset(
        "x86_64-apple-darwin",
        "6901d956b4f2b091343eaf3570944098488f3ffec018987145285ed8253c07d2",
      ),
      "linux-arm64": asset(
        "aarch64-unknown-linux-gnu",
        "73d8b9b87384b3115a183a8a51db9f7c205ce4c89ea511f3c8c8fea863038a50",
      ),
      "linux-x64": asset(
        "x86_64-unknown-linux-gnu",
        "4a08727a03094e5114db4438e4bd1d6182cc26eff37d6962115ea1ec1a491ca3",
      ),
      "win32-arm64": asset(
        "aarch64-pc-windows-msvc",
        "2e8fd876300eeee87afd6de18c79eb17bab425a9b755043c63d5023d58de37b7",
      ),
      "win32-x64": asset(
        "x86_64-pc-windows-msvc",
        "dbf0c36ec54cf727d34cc40c9994fe71b7d52e3c28a3112c3deca1aba46fbc8f",
      ),
    },
  },
  runtime: {
    program: "cargo",
    probe: ["--version"],
    installHint: "Install the Rust toolchain: https://rustup.rs",
  },
  installHint: "Install rust-analyzer: rustup component add rust-analyzer",
  initializationOptions: OPTIONS,
  settings: { "rust-analyzer": OPTIONS },
};
