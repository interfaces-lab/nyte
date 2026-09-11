import { Type } from "typebox";
import { Value } from "typebox/value";
import { MapDraft } from "./registry.ts";
import type { ModelContextPolicy } from "./types.ts";

const tokenCount = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const modelContextPolicy = Type.Object({ contextWindow: tokenCount, compactAt: tokenCount });

function validatePolicy(value: ModelContextPolicy): ModelContextPolicy {
  if (!Value.Check(modelContextPolicy, value) || value.compactAt > value.contextWindow) {
    throw new TypeError(
      "Model context policy requires 0 < compactAt <= contextWindow in whole tokens",
    );
  }
  return value;
}

/** Plugin contributions are checked before entering the session's context policy registry. */
export class ModelContextDraft extends MapDraft<ModelContextPolicy> {
  override set(id: string, value: ModelContextPolicy): void {
    super.set(id, validatePolicy(value));
  }

  override update(id: string, fn: (current: ModelContextPolicy) => ModelContextPolicy): void {
    super.update(id, (current) => validatePolicy(fn(current)));
  }
}
