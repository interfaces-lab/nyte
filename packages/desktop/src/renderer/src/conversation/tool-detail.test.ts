import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolTurnPart } from "@nyte-ai/core";
import { activityVerb, parseUnifiedPatch, presentTool, subagentCall } from "./tool-detail.ts";

const search: ToolTurnPart = {
  kind: "tool",
  callId: "search",
  toolName: "websearch",
  args: { query: "current releases" },
};

test.each([false, true])(
  "restored websearch heading keeps its effective route, isError=%s",
  (isError) => {
    const title = "Auto · Exa · saved key | current releases";
    const output = isError ? "Search request failed" : "[Release](https://example.test/release)";
    const result = presentTool(
      { ...search, result: { commit: "result", title, output, isError } },
      undefined,
      undefined,
    );
    assert.equal(result.detail, title);
    assert.equal(result.state, isError ? "failed" : "done");
    assert.deepEqual(result.body, { kind: "output", text: output });
  },
);

test("live search uses its route title and an untitled search still shows the query", () => {
  assert.equal(
    presentTool(
      search,
      { text: "Searching", title: "Auto · Exa · anonymous | current releases" },
      undefined,
    ).detail,
    "Auto · Exa · anonymous | current releases",
  );
  assert.equal(presentTool(search, undefined, undefined).detail, "query=current releases");
});

test("other generic tools keep argument detail ahead of their title", () => {
  assert.equal(
    presentTool({ ...search, toolName: "lookup" }, { text: "", title: "Lookup" }, undefined).detail,
    "query=current releases",
  );
});

const patch = "--- a/src/example.txt\n+++ b/src/example.txt\n@@ -1 +1 @@\n---old\n+++new\n";

function editResult(patch: string, output = "changed", isError = false): ToolTurnPart {
  return {
    kind: "tool",
    callId: "edit",
    toolName: "edit",
    args: { path: "/project/src/example.txt" },
    result: { commit: "result", output, isError, details: { patch } },
  };
}

test("desktop adapts core hunk counts and keeps relative path and basename display", () => {
  const presented = presentTool(editResult(patch), undefined, "/project");
  assert.equal(presented.verb, "Edited");
  assert.equal(presented.detail, "example.txt");
  assert.equal(presented.detailTitle, "src/example.txt");
  assert.equal(presented.state, "done");
  assert.equal(presented.added, 1);
  assert.equal(presented.removed, 1);
  assert.ok(presented.body.kind === "diff");
  assert.equal(presented.body.path, "src/example.txt");
  assert.equal(presented.body.diff.patch, patch);
  assert.deepEqual(parseUnifiedPatch(patch), { patch, added: 1, removed: 1 });
});

test.each(["\r", "\u2028", "\u2029"])(
  "embedded separator %j preserves the visible diff and raw patch",
  (separator) => {
    const patch = `--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+new${separator}@@ -1 +1 @@\n`;
    const presented = presentTool(editResult(patch), undefined, undefined);
    assert.equal(presented.state, "done");
    assert.equal(presented.added, 1);
    assert.equal(presented.removed, 1);
    assert.ok(presented.body.kind === "diff");
    assert.equal(presented.body.path, "example.txt");
    assert.equal(presented.body.diff.patch, patch);
    assert.equal(presented.body.diff.added, 1);
    assert.equal(presented.body.diff.removed, 1);
    assert.deepEqual(parseUnifiedPatch(patch), { patch, added: 1, removed: 1 });
  },
);

test.each([
  "--- a/a\n+++ b/a\n@@ -1,2 +1 @@\n-old\n+new\n",
  "--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old",
  "--- a/a\n+++ b/a\n@@ -1 +1 @@\n+new",
  "--- a/a\n+++ b/a\n@@ invalid @@\n-old\n+new\n",
  "--- a/a\n+++ b/a\n@@ -1 +1 @@\n context\n",
  "diff --git a/old b/new\nsimilarity index 100%\nrename from old\nrename to new\n",
  "not a patch",
])("unusable diffs retain ordinary result or blank output: %s", (patch) => {
  assert.equal(parseUnifiedPatch(patch), undefined);
  const presented = presentTool(editResult(patch, "ordinary output"), undefined, "/project");
  assert.deepEqual(presented.body, { kind: "output", text: "ordinary output" });
  assert.equal(presented.added, undefined);
  assert.equal(presented.removed, undefined);
  assert.deepEqual(presentTool(editResult(patch, " \n"), undefined, "/project").body, {
    kind: "none",
  });
});

test.each([
  ["constructor", "Constructor"],
  ["toString", "ToString"],
])("generic tool %s presents ordinary output and complete patches", (toolName, verb) => {
  const part: ToolTurnPart = {
    kind: "tool",
    callId: "call",
    toolName,
    result: { commit: "result", output: "ordinary output", isError: false },
  };
  const ordinary = presentTool(part, undefined, undefined);
  assert.equal(ordinary.verb, verb);
  assert.equal(ordinary.state, "done");
  assert.deepEqual(ordinary.body, { kind: "output", text: "ordinary output" });
  for (const complete of [patch, patch.trimEnd()]) {
    const presented = presentTool({ ...editResult(complete), toolName }, undefined, "/project");
    assert.equal(presented.verb, verb);
    assert.equal(presented.state, "done");
    assert.equal(presented.added, 1);
    assert.equal(presented.removed, 1);
    assert.ok(presented.body.kind === "diff");
    assert.equal(presented.body.path, "src/example.txt");
    assert.equal(presented.body.diff.patch, complete);
    assert.deepEqual(parseUnifiedPatch(complete), { patch: complete, added: 1, removed: 1 });
  }
});

test("failed edits retain their error and deletion paths use the old file", () => {
  const failed = presentTool(editResult(patch, "denied", true), undefined, "/project");
  assert.equal(failed.verb, "Edit failed");
  assert.equal(failed.state, "failed");
  assert.deepEqual(failed.body, { kind: "output", text: "denied" });
  const deleted = presentTool(
    editResult("--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n"),
    undefined,
    "/project",
  );
  assert.equal(deleted.added, undefined);
  assert.equal(deleted.removed, 1);
  assert.ok(deleted.body.kind === "diff");
  assert.equal(deleted.body.path, "gone.txt");
});

test("multi-file and hunk-only patches retain raw content and aggregate counts", () => {
  const multi =
    patch + "@@ -9 +9,2 @@\n context\n+extra\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n";
  assert.deepEqual(parseUnifiedPatch(multi), { patch: multi, added: 3, removed: 1 });
  const presented = presentTool(editResult(multi), undefined, "/project");
  assert.ok(presented.body.kind === "diff");
  assert.equal(presented.body.diff.patch, multi);
  assert.equal(presented.added, 3);
  assert.equal(presented.removed, 1);
  const hunk = "@@ -1 +1 @@\n-old\n+new\n";
  assert.deepEqual(parseUnifiedPatch(hunk), { patch: hunk, added: 1, removed: 1 });
});

test("patch cache holds 64 entries, refreshes hits and counts cached misses toward capacity", () => {
  const cachedPatch = (index: number) =>
    `--- a/cache-${String(index)}\n+++ b/cache-${String(index)}\n@@ -1 +1 @@\n-old\n+new\n`;
  const entries = Array.from({ length: 64 }, (_, index) => parseUnifiedPatch(cachedPatch(index)));
  assert.ok(entries.every((entry) => entry !== undefined));
  assert.equal(parseUnifiedPatch(cachedPatch(0)), entries[0]);
  assert.equal(parseUnifiedPatch("cache miss one"), undefined);
  assert.equal(parseUnifiedPatch(cachedPatch(0)), entries[0]);
  assert.notEqual(parseUnifiedPatch(cachedPatch(1)), entries[1]);
  // Reading a cached miss makes it recent, so it survives the next 63 insertions.
  assert.equal(parseUnifiedPatch("cache miss one"), undefined);
  const recent = Array.from({ length: 63 }, (_, index) =>
    parseUnifiedPatch(cachedPatch(index + 100)),
  );
  assert.equal(parseUnifiedPatch("cache miss one"), undefined);
  parseUnifiedPatch("cache miss two");
  assert.notEqual(parseUnifiedPatch(cachedPatch(100)), recent[0]);
  assert.equal(parseUnifiedPatch(cachedPatch(162)), recent[62]);
});

test("the run status names the wait behind the newest running tool", () => {
  assert.equal(activityVerb([]), undefined);
  assert.equal(activityVerb(["read"]), "Reading files");
  assert.equal(activityVerb(["read", "bash"]), "Running shell command");
  assert.equal(activityVerb(["bash", "task"]), "Waiting for subagent");
  assert.equal(activityVerb(["task", "read", "task"]), "Waiting for subagents");
  assert.equal(activityVerb(["mcp__linear__list_issues"]), "Running Linear: list issues");
});

test("a task call names its subagent and links to the child session once reported", () => {
  const task: ToolTurnPart = {
    kind: "tool",
    callId: "task",
    toolName: "task",
    args: { model: "anthropic/claude-opus-5", prompt: "Map the workbench" },
  };
  assert.deepEqual(subagentCall(task, undefined), {
    kind: "spawn",
    title: "anthropic/claude-opus-5",
    childSessionId: undefined,
  });
  assert.deepEqual(
    subagentCall(
      {
        ...task,
        args: {
          model: "anthropic/claude-opus-5",
          prompt: "Map the workbench",
          title: "Workbench map",
        },
      },
      { text: "", details: { childSessionId: "child-1" } },
    ),
    { kind: "spawn", title: "Workbench map", childSessionId: "child-1" },
  );
  const resolved = subagentCall(
    {
      ...task,
      result: { commit: "r", output: "", isError: false, details: { childSessionId: "child-2" } },
    },
    undefined,
  );
  assert.equal(resolved?.kind === "spawn" ? resolved.childSessionId : undefined, "child-2");
  assert.deepEqual(
    subagentCall({ ...task, toolName: "wait_task", args: { jobId: "job-7" } }, undefined),
    {
      kind: "await",
      jobId: "job-7",
    },
  );
  assert.equal(subagentCall({ ...task, toolName: "wait_task", args: {} }, undefined), undefined);
  assert.equal(subagentCall({ ...task, toolName: "bash" }, undefined), undefined);
});
