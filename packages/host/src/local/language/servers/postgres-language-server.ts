import type { Asset, ServerSpec } from "../spec.ts";

const VERSION = "0.28.2";

function asset(target: string, sha256: string, bytes: number): Asset {
  const windows = target.endsWith("windows-msvc");
  const suffix = windows ? ".exe" : "";

  return {
    url: `https://github.com/supabase-community/postgres-language-server/releases/download/${VERSION}/postgres-language-server_${target}${suffix}`,
    sha256,
    format: "file",
    bin: `postgres-language-server${suffix}`,
    bytes,
  };
}

export const POSTGRES_LANGUAGE_SERVER: ServerSpec = {
  name: "postgres-language-server",
  languages: ["sql"],
  rootMarkers: ["postgres-language-server.jsonc", "postgrestools.jsonc"],
  program: "postgres-language-server",
  arguments: ["lsp-proxy"],
  install: {
    kind: "release",
    package: "postgres-language-server",
    version: VERSION,
    assets: {
      "darwin-arm64": asset(
        "aarch64-apple-darwin",
        "e6d113284280977265e9d9000a47d9600d0fb58fe6d5d076726328678f5a66ec",
        26_489_696,
      ),
      "darwin-x64": asset(
        "x86_64-apple-darwin",
        "8c709d766ea9c6715a150dbca7c9c0e07dc0b6e585ba329449b0a22839921eca",
        27_181_760,
      ),
      "linux-arm64": asset(
        "aarch64-unknown-linux-gnu",
        "7be7de3660df047fd712f8fca4d6c42ecf1515daad952715eb02e29053ce256c",
        26_839_408,
      ),
      "linux-x64": asset(
        "x86_64-unknown-linux-gnu",
        "82ff82e39be65824378afa5d02626a1b42e8d8e48f97cb4938e4d477c8a9be52",
        28_907_544,
      ),
      "win32-arm64": asset(
        "aarch64-pc-windows-msvc",
        "90b2c06bc1720c795543965b33fec7e568d9d4d8534628e888c1b5e3d3ab4d5b",
        28_262_912,
      ),
      "win32-x64": asset(
        "x86_64-pc-windows-msvc",
        "585e028278d37f373510129f216a7163afd7e340127334aa6da6ca711a446060",
        31_500_288,
      ),
    },
  },
  installsOnRequest: true,
  installHint:
    "Install Postgres Language Server: brew install supabase-community/tap/postgres-language-server",
  settings: { format: { enabled: true } },
};
