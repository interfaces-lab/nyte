import type { ProviderEnv } from "../types.ts";

let procEnvCache: Map<string, string> | null = null;

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

export function getProviderEnvValue(name: string, env?: ProviderEnv): string | undefined {
  return (
    env?.[name] ||
    (typeof process !== "undefined" ? process.env[name] : undefined) ||
    getBunSandboxEnvValue(name) ||
    undefined
  );
}
