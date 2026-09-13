import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolTurnPart } from "@nyte-ai/core";
import { IDLE } from "../live-fold.ts";
import type { LiveToolProgress } from "../live.ts";
import { createWorkGroupPresentation } from "./work-group-presentation.ts";
import type { WorkGroupPresentationInput } from "./work-group-presentation.ts";

const defaults = {
  parts: [],
  liveTools: new Map<string, LiveToolProgress>(),
  cwd: "/project",
  durationMs: 1200,
  running: false,
  stale: false,
} satisfies WorkGroupPresentationInput;

function settled(callId: string, toolName: string, path = "/project/file.txt"): ToolTurnPart {
  return {
    kind: "tool",
    callId,
    toolName,
    args: { path },
    result: { commit: callId, output: "done", isError: false },
  };
}

function progress(callId: string, title: string): Map<string, LiveToolProgress> {
  return new Map([[callId, { runId: "run", progress: { text: title, title } }]]);
}

const patch = "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n";

test.each([10, 1000])(
  "progress preserves diff totals without reparsing %i settled tools",
  (size) => {
    let historicalReads = 0;
    const history = Array.from({ length: size }, (_, index): ToolTurnPart => ({
      ...settled(String(index), "edit"),
      get args() {
        historicalReads++;
        return { path: "/project/file.txt" };
      },
      result: { commit: String(index), output: "edited", isError: false, details: { patch } },
    }));
    const active: ToolTurnPart = {
      kind: "tool",
      callId: "active",
      toolName: "bash",
      args: { command: "pwd" },
    };
    const parts = [...history, active];
    const project = createWorkGroupPresentation();
    project({ ...defaults, parts, running: true });
    historicalReads = 0;
    for (let frame = 0; frame < 20; frame++) {
      const view = project({
        ...defaults,
        parts,
        running: true,
        liveTools: progress("active", String(frame)),
      });
      assert.equal(view.active, true);
      assert.equal(view.summary.added, size * 2);
      assert.equal(view.summary.removed, size);
    }
    assert.equal(historicalReads, 0, "progress must not revisit historical tool inputs");
    const finished = project({ ...defaults, parts: [...history, settled("active", "bash")] });
    assert.equal(finished.active, false);
    assert.equal(finished.summary.verb, "Worked");
    assert.equal(finished.summary.detail, "for 1s");
    assert.equal(finished.summary.added, size * 2);
    assert.equal(historicalReads, 0, "new durable arrays reuse unchanged tool presentations");
  },
);

test("changing branches replaces diff totals rather than retaining edits from the previous branch", () => {
  const project = createWorkGroupPresentation();
  const edit: ToolTurnPart = {
    ...settled("edit", "edit"),
    result: { commit: "edit", output: "", isError: false, details: { patch } },
  };
  const read = settled("read", "read", "/project/src/a.ts");
  assert.equal(project({ ...defaults, parts: [edit, read] }).summary.added, 2);
  assert.equal(project({ ...defaults, parts: [read] }).summary.added, 0);
  assert.equal(project({ ...defaults, parts: [edit, read] }).summary.added, 2);
  const refused: ToolTurnPart = {
    ...edit,
    result: { commit: "refused", output: "denied", isError: true },
  };
  assert.equal(project({ ...defaults, parts: [refused, read] }).summary.added, 0);
});

test("a failed command does not turn the enclosing work summary into a failure", () => {
  const project = createWorkGroupPresentation();
  const failed: ToolTurnPart = {
    ...settled("tests", "bash"),
    result: { commit: "failed", output: "Tests failed", isError: true },
  };
  const parts = [failed, settled("read", "read")];
  const active = project({ ...defaults, parts, running: true });
  assert.equal(active.active, true);
  assert.notEqual(active.summary.verb, "Work failed");
  const completed = project({ ...defaults, parts });
  assert.equal(completed.active, false);
  assert.equal(completed.summary.verb, "Worked");
  assert.equal(completed.summary.detail, "for 1s");
});

test("a missing tool result cannot keep a stopped or reopened historical group active", () => {
  const parts: ToolTurnPart[] = [{ kind: "tool", callId: "read", toolName: "read" }];
  const project = createWorkGroupPresentation();
  assert.equal(project({ ...defaults, parts, running: true }).active, true);
  assert.equal(project({ ...defaults, parts }).active, false);
  assert.equal(createWorkGroupPresentation()({ ...defaults, parts }).summary.verb, "Worked");
});

test("live activity retains task precedence while a run is active", () => {
  const project = createWorkGroupPresentation();
  const bash: ToolTurnPart = { kind: "tool", callId: "bash", toolName: "bash" };
  const read: ToolTurnPart = { kind: "tool", callId: "read", toolName: "read" };
  const task: ToolTurnPart = { kind: "tool", callId: "task", toolName: "task" };
  const input = { ...defaults, running: true };
  assert.equal(project({ ...input, parts: [bash, read] }).summary.verb, "Reading files");
  assert.equal(project({ ...input, parts: [read, bash] }).summary.verb, "Running shell command");
  assert.equal(project({ ...input, parts: [task, bash] }).summary.verb, "Waiting for subagent");
  assert.equal(
    project({ ...input, parts: [task, bash, { ...task, callId: "task2" }] }).summary.verb,
    "Waiting for subagents",
  );
});

test("between-step labels retain live order and the slow-response cue", () => {
  const project = createWorkGroupPresentation();
  const input = { ...defaults, running: true };
  assert.equal(project(input).summary.verb, "Preparing next move");
  assert.equal(project({ ...input, stale: true }).summary.verb, "This is taking a bit longer");
  const thinking = { kind: "thinking", runId: "run", attempt: 0, index: 0 } as const;
  const text = { ...thinking, kind: "text" } as const;
  assert.equal(
    project({ ...input, live: { ...IDLE, order: [text, thinking] }, stale: true }).summary.verb,
    "Thinking",
  );
  assert.equal(
    project({ ...input, live: { ...IDLE, order: [thinking, text] } }).summary.verb,
    "Working",
  );
});
