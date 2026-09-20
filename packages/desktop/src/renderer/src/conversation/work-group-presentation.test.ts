import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { ToolClass, ToolTurnPart } from "@nyte-ai/protocol";
import { IDLE } from "../live-fold.ts";
import { presentWorkGroup } from "./work-group-presentation.ts";
import type { WorkGroupPresentationInput } from "./work-group-presentation.ts";

const defaults = {
  parts: [],
  durationMs: 1200,
  running: false,
  stale: false,
  awaiting: 0,
} satisfies WorkGroupPresentationInput;

const read: ToolClass = { kind: "file_read", path: "/project/src/a.ts" };
const shell: ToolClass = { kind: "shell", command: "pwd" };
const spawn: ToolClass = { kind: "delegate", role: "create", session: sessionId("child") };
const patch: ToolClass = {
  kind: "file_patch",
  op: "edit",
  path: "/project/file.txt",
  added: 2,
  removed: 1,
  patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n",
};

function pending(callId: string, toolClass: ToolClass): ToolTurnPart {
  return { kind: "tool", callId, class: toolClass };
}

function settled(callId: string, toolClass: ToolClass, isError = false): ToolTurnPart {
  return { ...pending(callId, toolClass), result: { commit: callId, output: "done", isError } };
}

test("diff totals are the settled patches' own counts", () => {
  const edit = settled("edit", patch);
  assert.equal(
    presentWorkGroup({ ...defaults, parts: [edit, settled("read", read)] }).summary.added,
    2,
  );
  assert.equal(presentWorkGroup({ ...defaults, parts: [settled("read", read)] }).summary.added, 0);
  const refused = settled("refused", { kind: "file_edit", path: "/project/file.txt" }, true);
  const totals = presentWorkGroup({ ...defaults, parts: [refused, edit] }).summary;
  assert.equal(totals.added, 2);
  assert.equal(totals.removed, 1);
});

test("a failed command does not turn the enclosing work summary into a failure", () => {
  const parts = [settled("tests", shell, true), settled("read", read)];
  const active = presentWorkGroup({ ...defaults, parts, running: true });
  assert.equal(active.active, true);
  assert.notEqual(active.summary.verb, "Work failed");
  const completed = presentWorkGroup({ ...defaults, parts });
  assert.equal(completed.active, false);
  assert.equal(completed.summary.verb, "Worked");
  assert.equal(completed.summary.detail, "for 1s");
});

test("a missing tool result cannot keep a stopped or reopened historical group active", () => {
  const parts = [pending("read", read)];
  assert.equal(presentWorkGroup({ ...defaults, parts, running: true }).active, true);
  const stopped = presentWorkGroup({ ...defaults, parts });
  assert.equal(stopped.active, false);
  assert.equal(stopped.summary.verb, "Worked");
});

test("live activity names the newest running call and lets delegations win", () => {
  const input = { ...defaults, running: true };
  const bash = pending("bash", shell);
  const reading = pending("read", read);
  const task = pending("task", spawn);
  assert.equal(
    presentWorkGroup({ ...input, parts: [bash, reading] }).summary.verb,
    "Reading files",
  );
  assert.equal(
    presentWorkGroup({ ...input, parts: [reading, bash] }).summary.verb,
    "Running shell command",
  );
  assert.equal(
    presentWorkGroup({ ...input, parts: [settled("done", shell), reading] }).summary.verb,
    "Reading files",
  );
  assert.equal(
    presentWorkGroup({ ...input, parts: [task, bash] }).summary.verb,
    "Waiting for subagent",
  );
  assert.equal(
    presentWorkGroup({ ...input, parts: [task, bash, { ...task, callId: "task2" }] }).summary.verb,
    "Waiting for subagents",
  );
  assert.equal(
    presentWorkGroup({ ...input, parts: [bash], awaiting: 4 }).summary.verb,
    "Waiting for subagents",
  );
  assert.equal(presentWorkGroup({ ...input, awaiting: 1 }).summary.verb, "Waiting for subagent");
  assert.equal(
    presentWorkGroup({ ...input, parts: [pending("web", { kind: "custom", label: "Web search" })] })
      .summary.verb,
    "Running Web search",
  );
});

test("between-step labels retain live order and the slow-response cue", () => {
  const input = { ...defaults, running: true };
  assert.equal(presentWorkGroup(input).summary.verb, "Preparing next move");
  assert.equal(
    presentWorkGroup({ ...input, stale: true }).summary.verb,
    "This is taking a bit longer",
  );
  const thinking = { kind: "thinking", runId: "run", attempt: 0, index: 0 } as const;
  const text = { ...thinking, kind: "text" } as const;
  assert.equal(
    presentWorkGroup({ ...input, live: { ...IDLE, order: [text, thinking] }, stale: true }).summary
      .verb,
    "Thinking",
  );
  assert.equal(
    presentWorkGroup({ ...input, live: { ...IDLE, order: [thinking, text] } }).summary.verb,
    "Working",
  );
});
