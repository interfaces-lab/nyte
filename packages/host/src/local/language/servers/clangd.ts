import type { Asset, ServerSpec } from "../spec.ts";

const VERSION = "23.1.0";

const MAC_SHA256 = "1082e6638223b785ca2daf0939f13afcd0bb95c84ee9a4bbaff4745365159253";

function asset(platform: "mac" | "linux" | "windows", sha256: string): Asset {
  const windows = platform === "windows";

  return {
    url: `https://github.com/clangd/clangd/releases/download/${VERSION}/clangd-${platform}-${VERSION}.zip`,
    sha256,
    format: "zip",
    bin: `clangd_${VERSION}/bin/clangd${windows ? ".exe" : ""}`,
  };
}

export const CLANGD: ServerSpec = {
  name: "clangd",
  languages: ["c"],
  rootMarkers: [
    ".clangd",
    "compile_commands.json",
    "compile_flags.txt",
    ".clang-tidy",
    ".clang-format",
    "CMakeLists.txt",
    "meson.build",
    "Makefile",
  ],
  program: "clangd",
  install: {
    kind: "release",
    package: "clangd",
    version: VERSION,
    assets: {
      "darwin-arm64": asset("mac", MAC_SHA256),
      "darwin-x64": asset("mac", MAC_SHA256),
      "linux-x64": asset(
        "linux",
        "e53b1a96196095faedb7642cf64964f7fb9ad4a0c1f00dd2c172a3d9dcbafdfd",
      ),
      "win32-x64": asset(
        "windows",
        "23412a240756a162e7b98a282f36aa2a23a88db5ce16a0cbc4fef7253768c810",
      ),
    },
  },
  installHint:
    "Install clangd: brew install llvm, apt install clangd, or download from github.com/clangd/clangd/releases",
  initializationOptions: { clangdFileStatus: true, fallbackFlags: [] },
};
