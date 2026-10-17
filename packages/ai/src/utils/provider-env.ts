/**
 * Provider-scoped environment lookup: request-scoped overrides first, then process.env, then the Bun sandbox fallback.
 */
import type { ProviderEnv } from "../types.ts";

let procEnvCache: Map<string, string> | null = null;

/**
 * Fallback for https://github.com/oven-sh/bun/issues/27802.
 * Bun compiled binaries can expose an empty process.env inside Linux sandboxes
 * even though /proc/self/environ contains the environment.
 *
 * This intentionally duplicates restoreSandboxEnv() in
 * packages/coding-agent/src/bun/restore-sandbox-env.ts. The ai package can be
 * used directly, without going through that entrypoint, so provider env lookup
 * must not depend on process.env having been patched. A missing or unreadable
 * /proc/self/environ reads as empty.
 */
function getBunSandboxEnvValue(name: string): string | undefined {
  if (
    typeof process === "undefined" ||
    !process.versions?.bun ||
    Object.keys(process.env).length > 0
  ) {
    return undefined;
  }

  if (procEnvCache === null) {
    procEnvCache = new Map();

    try {
      const data = process.getBuiltinModule("node:fs").readFileSync("/proc/self/environ", "utf-8");

      for (const entry of data.split("\0")) {
        const variable = /^([^=]+)=(.*)$/su.exec(entry);

        if (variable) procEnvCache.set(variable[1], variable[2]);
      }
    } catch {
      return undefined;
    }
  }

  return procEnvCache.get(name);
}

/**
 * Resolve a provider env value from scoped overrides, normal process.env, then
 * the duplicated Bun sandbox fallback for direct @nyte-ai/ai consumers.
 */
export function getProviderEnvValue(name: string, env?: ProviderEnv): string | undefined {
  return (
    env?.[name] ||
    (typeof process !== "undefined" ? process.env[name] : undefined) ||
    getBunSandboxEnvValue(name) ||
    undefined
  );
}
