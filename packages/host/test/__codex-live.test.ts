import { test } from "vitest";
import { readCodexUsage } from "../src/usage.ts";

test("live", async () => {
  const result = await readCodexUsage({ models: { getModels: () => [] } });
  if (result.kind !== "ready") {
    console.log("kind", result);
    return;
  }
  const t = result.summary.total;
  console.log("totalTokens", t.totalTokens.toLocaleString());
  console.log("input", t.input.toLocaleString(), "output", t.output.toLocaleString());
  console.log(
    "cacheRead",
    t.cacheRead.toLocaleString(),
    "cacheWrite",
    t.cacheWrite.toLocaleString(),
  );
  console.log(
    "models",
    result.summary.models.length,
    "unpriced",
    result.unpricedRecords,
    "malformed",
    result.malformedRecords,
    "unreadable",
    result.unreadableFiles,
  );
  console.log(
    "top",
    result.summary.models
      .toSorted((a, b) => b.usage.totalTokens - a.usage.totalTokens)
      .slice(0, 6)
      .map((m) => `${m.model}=${m.usage.totalTokens.toLocaleString()} (${m.turns})`),
  );
}, 120_000);
