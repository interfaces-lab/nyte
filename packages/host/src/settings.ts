import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheWarmingMode } from "@nyte-ai/core";
import { isFileError, nyteHome } from "./paths.ts";

export function cacheWarmingMode(value: unknown): CacheWarmingMode {
  return value === "off" || value === "streaming" || value === "idle" ? value : "streaming";
}

export async function readCacheWarmingMode(): Promise<CacheWarmingMode> {
  const text = await readFile(join(nyteHome(), "settings.json"), "utf8").catch((cause: unknown) => {
    if (isFileError(cause, ["ENOENT"])) return undefined;
    throw cause;
  });
  if (text === undefined) return "streaming";
  const settings: unknown = JSON.parse(text);
  return cacheWarmingMode(
    typeof settings === "object" && settings !== null && "cacheWarming" in settings
      ? settings.cacheWarming
      : undefined,
  );
}
