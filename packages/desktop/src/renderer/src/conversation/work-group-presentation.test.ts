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
  durationMs: 0,
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

test.each([10, 1000])("progress work stays independent of %i settled tools", (size) => {
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
  const initial = project({ ...defaults, parts, liveTools: progress("active", "first") });
  assert.deepEqual(initial, {
    active: true,
    failed: false,
    summary: { verb: "Running shell command", detail: undefined, added: size * 2, removed: size },
  });
  historicalReads = 0;
  const tools = progress("active", "second");
  for (let frame = 0; frame < 20; frame++) {
    assert.deepEqual(
      project({
        ...defaults,
        parts,
        liveTools: frame === 0 ? tools : progress("active", String(frame)),
      }),
      initial,
    );
  }
  assert.equal(historicalReads, 0, "progress must not read historical tool inputs");
  assert.deepEqual(project({ ...defaults, parts, liveTools: tools }), initial);
  assert.equal(historicalReads, 0);
  const finished = project({ ...defaults, parts: [...history, settled("active", "bash")] });
  assert.deepEqual(finished, {
    active: false,
    failed: false,
    summary: {
      verb: "Edited",
      detail: `${String(size)} files, ran 1 command`,
      added: size * 2,
      removed: size,
    },
  });
  assert.equal(historicalReads, 0, "new durable arrays reuse unchanged tool presentations");
});

test("same snapshots skip presentation and removing progress restores the durable title", () => {
  let reads = 0;
  const part: ToolTurnPart = {
    ...settled("search", "websearch"),
    get args() {
      reads++;
      return { query: "releases" };
    },
  };
  const parts = [part];
  const project = createWorkGroupPresentation();
  const tools = progress("search", "Live route");
  assert.equal(project({ ...defaults, parts, liveTools: tools }).summary.detail, "Live route");
  reads = 0;
  assert.equal(project({ ...defaults, parts, liveTools: tools }).summary.detail, "Live route");
  assert.equal(reads, 0);
  assert.equal(
    project({ ...defaults, parts, liveTools: progress("search", "New route") }).summary.detail,
    "New route",
  );
  assert.equal(project({ ...defaults, parts }).summary.detail, "query=releases");
});

test("arbitrary results, removals, branches and cwd changes replace summary contributions", () => {
  const project = createWorkGroupPresentation();
  const edit: ToolTurnPart = {
    ...settled("edit", "edit"),
    result: { commit: "edit", output: "", isError: false, details: { patch } },
  };
  const read = settled("read", "read", "/project/src/a.ts");
  const original = [edit, read];
  assert.deepEqual(project({ ...defaults, parts: original }).summary, {
    verb: "Edited",
    detail: "file.txt",
    added: 2,
    removed: 1,
  });
  const failed: ToolTurnPart = {
    ...edit,
    result: { commit: "failed", output: "denied", isError: true },
  };
  assert.deepEqual(project({ ...defaults, parts: [failed, read] }), {
    active: false,
    failed: true,
    summary: { verb: "Work failed", detail: undefined, added: 0, removed: 0 },
  });
  const branch = [read];
  assert.deepEqual(project({ ...defaults, parts: branch }).summary, {
    verb: "Read",
    detail: "src/a.ts",
    added: 0,
    removed: 0,
  });
  assert.equal(
    project({ ...defaults, parts: branch, cwd: "/elsewhere" }).summary.detail,
    "/project/src/a.ts",
  );
  assert.equal(project({ ...defaults, parts: branch }).summary.detail, "src/a.ts");
  assert.deepEqual(project({ ...defaults, parts: original }).summary, {
    verb: "Edited",
    detail: "file.txt",
    added: 2,
    removed: 1,
  });
  assert.equal(project(defaults).summary.verb, "Worked");
});

test("running order, task precedence and unknown names survive reorder and settlement", () => {
  const project = createWorkGroupPresentation();
  const bash: ToolTurnPart = { kind: "tool", callId: "bash", toolName: "bash" };
  const read: ToolTurnPart = { kind: "tool", callId: "read", toolName: "read" };
  const task: ToolTurnPart = { kind: "tool", callId: "task", toolName: "task" };
  assert.equal(project({ ...defaults, parts: [bash, read] }).summary.verb, "Reading files");
  assert.equal(project({ ...defaults, parts: [read, bash] }).summary.verb, "Running shell command");
  assert.equal(project({ ...defaults, parts: [task, bash] }).summary.verb, "Waiting for subagent");
  assert.equal(
    project({ ...defaults, parts: [task, bash, { ...task, callId: "task2" }] }).summary.verb,
    "Waiting for subagents",
  );
  const unknown: ToolTurnPart = {
    kind: "tool",
    callId: "unknown",
    toolName: "mcp__linear__list_issues",
  };
  assert.equal(
    project({ ...defaults, parts: [unknown] }).summary.verb,
    "Running Linear: list issues",
  );
  const failed: ToolTurnPart = {
    ...settled("failed", "read"),
    result: { commit: "failed", output: "error", isError: true },
  };
  assert.deepEqual(project({ ...defaults, parts: [failed, unknown] }), {
    active: true,
    failed: true,
    summary: { verb: "Running Linear: list issues", detail: undefined, added: 0, removed: 0 },
  });
});

test("between-step labels retain live order, overlay and stale precedence", () => {
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
  assert.equal(
    project({
      ...input,
      live: { ...IDLE, tools: progress("elsewhere", "busy"), order: [thinking] },
    }).summary.verb,
    "Working",
  );
  assert.equal(project({ ...defaults, durationMs: 1200 }).summary.detail, "for 1s");
});

test.each([
  [[settled("a", "bash")], "Ran", "path=/project/file.txt"],
  [[settled("a", "read"), settled("b", "read")], "Read", "2 files"],
  [[settled("a", "ls"), settled("b", "ls")], "Listed", "2 directories"],
  [[settled("a", "task")], "Task", "path=/project/file.txt"],
  [[settled("a", "lookup"), settled("b", "task")], "Worked", "2 actions"],
] as const)("settled category summary %#", (parts, verb, detail) => {
  assert.deepEqual(createWorkGroupPresentation()({ ...defaults, parts }).summary, {
    verb,
    detail,
    added: 0,
    removed: 0,
  });
});
