import { expect, test } from "vitest";
import { sessionMark } from "../src/client.ts";
import type { HeadInfo, RunPhase } from "@nyte-ai/protocol";

function head(phase: RunPhase): HeadInfo {
  return {
    head: "main",
    tip: null,
    run: { runId: "run", head: "main", phase, startedAt: 0, attempts: 1, config: {} },
  };
}

test("clients derive execution state without treating background waits as a reply request", () => {
  expect(sessionMark({ heads: [] })).toBe("idle");
  expect(sessionMark({ heads: [head({ kind: "waiting" })] })).toBe("waiting");
  expect(sessionMark({ heads: [head({ kind: "retry", at: 10, error: "retry" })] })).toBe("retry");
  expect(sessionMark({ heads: [head({ kind: "failed", error: "failed" })] })).toBe("failed");
});

test("an active head takes priority over earlier failures", () => {
  expect(
    sessionMark({ heads: [head({ kind: "failed", error: "failed" }), head({ kind: "tools" })] }),
  ).toBe("working");
  expect(sessionMark({ heads: [head({ kind: "done" }), head({ kind: "aborted" })] })).toBe("idle");
});
