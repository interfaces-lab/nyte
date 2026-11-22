import type { Asset, ServerSpec } from "../spec.ts";

const VERSION = "1.11.3";

function asset(target: string, sha256: string, bytes: number): Asset {
  const windows = target.endsWith("windows-msvc");
  const name = `tombi-cli-${VERSION}-${target}`;

  return {
    url: `https://github.com/tombi-toml/tombi/releases/download/v${VERSION}/${name}.${windows ? "zip" : "tar.gz"}`,
    sha256,
    format: windows ? "zip" : "tar.gz",
    bin: windows ? "tombi.exe" : `${name}/tombi`,
    bytes,
  };
}

export const TOMBI: ServerSpec = {
  name: "tombi",
  languages: ["toml"],
  rootMarkers: [".tombi.toml", "tombi.toml", ".config/tombi.toml"],
  program: "tombi",
  arguments: ["lsp"],
  env: { NO_COLOR: "1" },
  install: {
    kind: "release",
    package: "tombi",
    version: VERSION,
    assets: {
      "darwin-arm64": asset(
        "aarch64-apple-darwin",
        "4e7daae9197910fe3717d241e5ca85cafd0f7f0ead988056fdd0b2cf2a447600",
        8_347_653,
      ),
      "darwin-x64": asset(
        "x86_64-apple-darwin",
        "642900713c3cb04adf45264117649e5f4731395b62cbafee8a9a2824fa479684",
        8_982_656,
      ),
      "linux-arm64": asset(
        "aarch64-unknown-linux-musl",
        "083614471a69e15f147ba68c96fe1e3ea02e8efe38d6bcdb4606b5a37ab8758a",
        8_581_518,
      ),
      "linux-x64": asset(
        "x86_64-unknown-linux-musl",
        "36672279d05f093455f01fa5a2799a8cc2162a9195cbbb23f0f8d1107d0de497",
        9_354_244,
      ),
      "win32-arm64": asset(
        "aarch64-pc-windows-msvc",
        "621bf39b23546ecf9b2b4759f4203d6c5040a40ccd2abe17fa731999de1f81f0",
        10_392_885,
      ),
      "win32-x64": asset(
        "x86_64-pc-windows-msvc",
        "b6b2d9e6419216aaa0b8e74a5c81c48335cb193d6eb87f50a7d77468bce10073",
        11_415_716,
      ),
    },
  },
  installsOnRequest: true,
  installHint: "Install Tombi: uv tool install tombi, brew install tombi, or npm install -g tombi",
  initializationOptions: {
    semanticTokens: { strings: { enabled: true }, comments: { enabled: true } },
  },
};
