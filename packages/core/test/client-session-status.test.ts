import { expect, test } from "vitest";
import { sessionMark } from "@nyte-ai/client";
import type { HeadInfo, RunPhase } from "@nyte-ai/protocol";

function head(phase: RunPhase, awaitingReply?: true): HeadInfo {
  const run = {
    runId: "run",
    head: "main",
    origin: { kind: "user" } as const,
    root: "run",
    phase,
    startedAt: 0,
    attempts: 1,
    config: {},
  };
  return {
    head: "main",
    tip: null,
    run: awaitingReply === undefined ? run : { ...run, awaitingReply },
  };
}

test("clients derive execution state without treating background waits as a reply request", () => {
  expect(sessionMark({ heads: [] })).toBe("idle");
  expect(sessionMark({ heads: [head({ kind: "waiting" }, true)] })).toBe("waiting");
  // A call parked on a timer or on background work asks nothing of a reader.
  expect(sessionMark({ heads: [head({ kind: "waiting" })] })).toBe("working");
  expect(
    sessionMark({
      heads: [
        head({
          kind: "retry",
          at: 10,
          retries: 1,
          failure: { class: "provider", message: "retry" },
        }),
      ],
    }),
  ).toBe("retry");
  expect(
    sessionMark({
      heads: [head({ kind: "failed", failure: { class: "provider", message: "failed" } })],
    }),
  ).toBe("failed");
});

test("an active head takes priority over earlier failures", () => {
  expect(
    sessionMark({
      heads: [
        head({ kind: "failed", failure: { class: "provider", message: "failed" } }),
        head({ kind: "tools" }),
      ],
    }),
  ).toBe("working");
  expect(sessionMark({ heads: [head({ kind: "done" }), head({ kind: "aborted" })] })).toBe("idle");
});
