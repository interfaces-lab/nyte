/** The settled step header counts what the calls did, read from their typed state, never from the class alone. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolState, TurnToolClass } from "@nyte-ai/protocol";
import { durableStepGroupPresentation } from "./step-group-presentation.ts";
import type { StepTurnPart } from "./transcript-presentation.ts";

const settled = { commit: "c" } as const;

const SUCCESS: ToolState = { kind: "success", ...settled };

const EXIT: ToolState = { kind: "error", reason: { kind: "exit", code: 1 }, ...settled };

const DENIED: ToolState = { kind: "error", reason: { kind: "denied" }, ...settled };

const STOPPED: ToolState = { kind: "error", reason: { kind: "cancelled" }, ...settled };

let calls = 0;

function call(toolClass: TurnToolClass, state: ToolState): StepTurnPart {
  calls += 1;

  return { kind: "tool", callId: `call-${String(calls)}`, at: calls, class: toolClass, state };
}

const shell = (command: string, state: ToolState) => call({ kind: "shell", command }, state);

function summary(parts: readonly StepTurnPart[]) {
  const presentation = durableStepGroupPresentation({
    parts,
    durationMs: 0,
    added: 0,
    removed: 0,
    running: false,
  });

  assert.equal(presentation.active, false);

  return presentation.active ? undefined : presentation.summary;
}

test("a step whose calls all succeeded keeps its verb", () => {
  assert.deepEqual(summary([shell("pnpm test", SUCCESS), shell("pnpm lint", SUCCESS)]), {
    verb: "Ran",
    detail: "2 commands",
    added: 0,
    removed: 0,
  });
});

test("a step that lost a call tallies each outcome instead of claiming a verb", () => {
  assert.equal(
    summary([shell("pnpm test", SUCCESS), shell("pnpm lint", SUCCESS), shell("rm -rf /", DENIED)])
      ?.verb,
    "2 commands succeeded, 1 failed",
  );

  const mixed = summary([
    call({ kind: "file_read", path: "/w/a.ts" }, SUCCESS),
    shell("pnpm test", EXIT),
    shell("pnpm build", STOPPED),
    shell("sleep 1", STOPPED),
  ]);

  assert.equal(mixed?.verb, "1 file read, 1 failed, 2 stopped");
  assert.equal(mixed?.detail, undefined);
});

test("a step whose every call failed or stopped never merges the two", () => {
  assert.equal(summary([shell("a", EXIT), shell("b", STOPPED)])?.verb, "1 call failed, 1 stopped");
  assert.equal(summary([shell("a", EXIT), shell("b", DENIED)])?.verb, "2 calls failed");
  assert.equal(summary([shell("a", STOPPED), shell("b", STOPPED)])?.verb, "2 calls stopped");
});

test("a running step lists only the calls still open", () => {
  const presentation = durableStepGroupPresentation({
    parts: [shell("pnpm test", SUCCESS), shell("pnpm lint", { kind: "running" })],
    durationMs: 0,
    added: 0,
    removed: 0,
    running: true,
  });

  assert.equal(presentation.active, true);

  if (presentation.active) {
    assert.deepEqual(presentation.runningClasses, [{ kind: "shell", command: "pnpm lint" }]);
  }
});
