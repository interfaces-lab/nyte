import type { Json, LanguageName } from "@nyte-ai/schema";

export const PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const INSTALL_FOLDER = "{folder}";

export type ArchiveFormat = "file" | "gz" | "tar.gz" | "zip";

export interface Asset {
  readonly url: string;
  readonly sha256: string;
  readonly format: ArchiveFormat;
  readonly bin: string;
}

export interface NpmPackage {
  readonly path: string;
  readonly url: string;
  readonly integrity: string;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
}

export type Install =
  | {
      readonly kind: "release";
      readonly version: string;
      readonly assets: Readonly<Partial<Record<Platform, Asset>>>;
    }
  | {
      readonly kind: "npm";
      readonly version: string;
      readonly packages: readonly NpmPackage[];
      readonly entry: string;
    }
  | {
      readonly kind: "toolchain";
      readonly version: string;
      readonly program: string;
      readonly arguments: readonly string[];
      readonly env: Readonly<Record<string, string>>;
      readonly bin: string;
    };

export interface ServerSpec {
  readonly name: string;
  readonly languages: readonly LanguageName[];
  readonly rootMarkers: readonly string[];
  readonly requiresRootMarker: boolean;
  readonly program: string;
  readonly probe: readonly string[] | null;
  readonly arguments: readonly string[];
  readonly install: Install | null;
  readonly runtime: {
    readonly program: string;
    readonly probe: readonly string[];
    readonly installHint: string;
  } | null;
  readonly installHint: string;
  readonly initializationOptions: Json;
  readonly settings: Json;
  prepare?(
    root: string,
  ): Promise<{ readonly initializationOptions: Json; readonly runsOn: string | null }>;
}
