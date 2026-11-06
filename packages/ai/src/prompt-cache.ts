import type { CacheRetention, PromptCachePolicy, ProviderEnv } from "./types.ts";
import { getProviderEnvValue } from "./utils/provider-env.ts";

export function resolveCacheRetention(
  retention?: CacheRetention,
  env?: ProviderEnv,
): CacheRetention {
  if (retention !== undefined) return retention;

  return getProviderEnvValue("NYTE_CACHE_RETENTION", env) === "short" ? "short" : "long";
}

export function promptCacheMinimumTtlMs(
  policy: PromptCachePolicy | undefined,
  retention: CacheRetention,
): number | undefined {
  if (policy === undefined || retention === "none") return undefined;

  return policy.minimumRetentionMs[retention];
}
