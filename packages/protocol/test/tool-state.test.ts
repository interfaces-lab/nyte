/** The tool-state schemas: every variant has a spelling, every illegal state has none. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { Value } from "typebox/value";
import {
  Commit,
  ToolOutcome,
  ToolReason,
  ToolState,
  ToolTurnPart,
  TurnToolClass,
} from "../src/schemas.ts";

test("each reason, outcome, and state variant is accepted", () => {
  for (const kind of ["error", "timeout", "denied", "cancelled", "interrupted"] as const) {
    assert.ok(Value.Check(ToolReason, { kind }));
  }

  assert.ok(Value.Check(ToolReason, { kind: "exit", code: 1 }));
  assert.ok(Value.Check(ToolReason, { kind: "exit", code: -9 }));
  assert.ok(Value.Check(ToolOutcome, { kind: "success" }));
  assert.ok(Value.Check(ToolOutcome, { kind: "error", reason: { kind: "timeout" } }));
  assert.ok(Value.Check(ToolState, { kind: "pending" }));
  assert.ok(Value.Check(ToolState, { kind: "running" }));
  assert.ok(
    Value.Check(ToolState, { kind: "running", waitingFor: { kind: "input", waitId: "w1" } }),
  );
  assert.ok(Value.Check(ToolState, { kind: "success", commit: "c1" }));
  assert.ok(Value.Check(ToolState, { kind: "success", commit: null }));
  assert.ok(
    Value.Check(ToolState, { kind: "error", reason: { kind: "exit", code: 2 }, commit: "c1" }),
  );
  assert.ok(
    Value.Check(ToolState, { kind: "error", reason: { kind: "interrupted" }, commit: null }),
  );
  assert.ok(Value.Check(ToolState, { kind: "pending", later: true }));
  assert.ok(Value.Check(ToolState, { kind: "success", commit: "c1", later: true }));
});

test("an illegal state has no spelling", () => {
  assert.equal(Value.Check(ToolReason, { kind: "exit", code: 0 }), false);
  assert.equal(Value.Check(ToolReason, { kind: "exit", code: 1.5 }), false);
  assert.equal(Value.Check(ToolReason, { kind: "exit" }), false);
  assert.equal(Value.Check(ToolReason, { kind: "timeout", code: 1 }), false);
  assert.equal(Value.Check(ToolOutcome, { kind: "success", reason: { kind: "error" } }), false);
  assert.equal(Value.Check(ToolOutcome, { kind: "error" }), false);
  assert.equal(Value.Check(ToolState, { kind: "success" }), false);
  assert.equal(Value.Check(ToolState, { kind: "pending", commit: null }), false);
  assert.equal(Value.Check(ToolState, { kind: "running", waitingFor: { kind: "input" } }), false);
  assert.equal(Value.Check(ToolState, { kind: "running", commit: "c1" }), false);
  assert.equal(
    Value.Check(ToolState, {
      kind: "success",
      commit: "c1",
      waitingFor: { kind: "input", waitId: "w1" },
    }),
    false,
  );
  assert.equal(
    Value.Check(ToolState, { kind: "success", commit: "c1", reason: { kind: "error" } }),
    false,
  );
});

test("a tool part carries its state and optionally its output", () => {
  const part = {
    kind: "tool",
    callId: "c1",
    at: 1,
    class: { kind: "shell", command: "ls" },
    state: { kind: "success", commit: "c1" },
  };
  assert.ok(Value.Check(ToolTurnPart, part));
  assert.ok(Value.Check(ToolTurnPart, { ...part, output: "a\nb" }));
  assert.equal(Value.Check(ToolTurnPart, { ...part, state: undefined }), false);
  assert.equal(Value.Check(ToolTurnPart, { ...part, output: 1 }), false);
});

test("a shell class may carry what core measured; the exit code is never among it", () => {
  const shell = { kind: "shell", command: "ls" };
  assert.ok(Value.Check(TurnToolClass, shell));
  assert.ok(Value.Check(TurnToolClass, { ...shell, facts: { durationMs: 12, truncated: false } }));
  assert.ok(
    Value.Check(TurnToolClass, {
      ...shell,
      facts: { durationMs: 12, truncated: true, fullOutputPath: "/tmp/out" },
    }),
  );
  assert.equal(Value.Check(TurnToolClass, { ...shell, facts: { durationMs: 12 } }), false);
  assert.equal(
    Value.Check(TurnToolClass, { ...shell, facts: { durationMs: -1, truncated: false } }),
    false,
  );
  assert.equal(Value.Check(TurnToolClass, { ...shell, facts: { truncated: false } }), false);
});

test("a result commit stores how it settled under `settlement`; `outcome` stays forbidden for older readers", () => {
  const commit = {
    kind: "commit",
    parent: null,
    at: 1,
    body: {
      kind: "message",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        content: [],
        isError: true,
        timestamp: 1,
      },
    },
    call: { kind: "shell", command: "ls" },
    tree: null,
  };
  assert.ok(Value.Check(Commit, commit));
  assert.ok(
    Value.Check(Commit, {
      ...commit,
      settlement: { kind: "error", reason: { kind: "exit", code: 1 } },
    }),
  );
  assert.ok(Value.Check(Commit, { ...commit, settlement: { kind: "success" } }));
  assert.equal(Value.Check(Commit, { ...commit, settlement: { kind: "ok" } }), false);
  assert.equal(Value.Check(Commit, { ...commit, outcome: { kind: "success" } }), false);
});
