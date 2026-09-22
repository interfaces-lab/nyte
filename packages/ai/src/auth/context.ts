/**
 * Default `AuthContext`: env vars from `process.env` and file existence via
 * node:fs, both loaded through `process.getBuiltinModule` so browser bundlers do
 * not try to resolve node builtins (where they simply report nothing).
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/auth/context.ts
 * Synced with pi 7ebf9087e.
 */
import type { AuthContext } from "./types.ts";

/**
 * Default auth context: env vars from `process.env` (undefined in browsers),
 * file existence via node:fs (always false in browsers).
 */
export function defaultProviderAuthContext(): AuthContext {
  return {
    async env(name: string): Promise<string | undefined> {
      if (typeof process === "undefined") return undefined;
      const value = process.env[name];

      return value !== undefined && value.trim().length > 0 ? value : undefined;
    },

    async fileExists(path: string): Promise<boolean> {
      try {
        const resolved = path.startsWith("~")
          ? process.getBuiltinModule("node:os").homedir() + path.slice(1)
          : path;

        await process.getBuiltinModule("node:fs/promises").access(resolved);

        return true;
      } catch {
        return false;
      }
    },
  };
}
