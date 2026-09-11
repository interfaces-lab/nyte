import assert from "node:assert/strict";
import { test } from "vitest";
import { ModelContextDraft } from "../src/plugins/model-context.ts";

const ref = "openai/gpt-6-astra";
const policy = { contextWindow: 1_000_000, compactAt: 400_000 };

test("an invalid context policy cannot replace a valid contribution; the window boundary is valid", () => {
  const draft = new ModelContextDraft();
  draft.set(ref, policy);
  for (const invalid of [
    { contextWindow: 0, compactAt: 1 },
    { contextWindow: -1, compactAt: 1 },
    { contextWindow: 1.5, compactAt: 1 },
    { contextWindow: Infinity, compactAt: 1 },
    { contextWindow: Number.MAX_SAFE_INTEGER + 1, compactAt: 1 },
    { contextWindow: 1_000_000, compactAt: 0 },
    { contextWindow: 1_000_000, compactAt: -1 },
    { contextWindow: 1_000_000, compactAt: 1.5 },
    { contextWindow: 1_000_000, compactAt: NaN },
    { contextWindow: 1_000_000, compactAt: 1_000_001 },
  ]) {
    assert.throws(() => draft.set(ref, invalid), TypeError, JSON.stringify(invalid));
    assert.throws(() => draft.update(ref, () => invalid), TypeError, JSON.stringify(invalid));
    assert.deepEqual(draft.get(ref), policy);
  }
  draft.update(ref, (current) => ({ ...current, compactAt: current.contextWindow }));
  assert.deepEqual(draft.get(ref), { contextWindow: 1_000_000, compactAt: 1_000_000 });
});
