import { PLATFORMS } from "../spec.ts";
import type { Asset, Platform } from "../spec.ts";

const TARGETS = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
} as const satisfies Record<Platform, string>;

export function rustAssets(
  asset: (target: string, sha256: string) => Asset,
  sha256: Readonly<Record<Platform, string>>,
): Readonly<Partial<Record<Platform, Asset>>> {
  return Object.fromEntries(
    PLATFORMS.map((platform) => [platform, asset(TARGETS[platform], sha256[platform])]),
  );
}
