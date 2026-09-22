import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionId, ToolClass, ToolTurnPart } from "@nyte-ai/protocol";
import { IDLE } from "../live-fold.ts";
import { presentWorkGroup } from "./work-group-presentation.ts";
import type { WorkGroupPresentationInput } from "./work-group-presentation.ts";

const defaults = {
  parts: [],
  durationMs: 1200,
  added: 0,
  removed: 0,
  running: false,
  awaited: new Set<SessionId>(),
} satisfies WorkGroupPresentationInput;

const child = sessionId("child");
const other = sessionId("other");
const read: ToolClass = { kind: "file_read", path: "/project/src/a.ts" };
const shell: ToolClass = { kind: "shell", command: "pwd" };
const spawn: ToolClass = {
  kind: "delegate",
  role: "create",
  title: "Child",
  target: { kind: "one", session: child },
};
const patch: ToolClass = {
  kind: "file_patch",
  op: "edit",
  path: "/project/file.txt",
  added: 2,
  removed: 1,
  patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n",
};

function pending(callId: string, toolClass: ToolClass): ToolTurnPart {
  return { kind: "tool", callId, class: toolClass, at: 0 };
}

function settled(callId: string, toolClass: ToolClass, isError = false): ToolTurnPart {
  return { ...pending(callId, toolClass), result: { commit: callId, output: "done", isError } };
}

test("diff totals come from the run diff, not the episode's patches", () => {
  const edit = settled("edit", patch);
  const totals = presentWorkGroup({
    ...defaults,
    parts: [edit, settled("read", read)],
    added: 7,
    removed: 4,
  }).summary;
  assert.equal(totals.added, 7);
  assert.equal(totals.removed, 4);
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
    presentWorkGroup({ ...input, parts: [pending("web", { kind: "custom", label: "Web search" })] })
      .summary.verb,
    "Running Web search",
  );
});

test("waits count the children they name, not the calls that name them", () => {
  const input = { ...defaults, running: true };
  const task = pending("task", spawn);
  const again = pending("task2", spawn);
  const elsewhere = pending("task3", { ...spawn, target: { kind: "one", session: other } });
  const sameChild = presentWorkGroup({ ...input, parts: [task, again], awaited: new Set([child]) });
  assert.equal(sameChild.summary.verb, "Waiting for subagent");
  assert.deepEqual(sameChild.active && sameChild.waiting, [child]);
  const twoChildren = presentWorkGroup({ ...input, parts: [task, elsewhere] });
  assert.equal(twoChildren.summary.verb, "Waiting for subagents");
  assert.deepEqual(twoChildren.active && twoChildren.waiting, [child, other]);
  assert.equal(
    presentWorkGroup({ ...input, awaited: new Set([child, other]) }).summary.verb,
    "Waiting for subagents",
  );
  assert.equal(
    presentWorkGroup({ ...input, awaited: new Set([child]) }).summary.verb,
    "Waiting for subagent",
  );
});

test("between-step labels follow the live order", () => {
  const input = { ...defaults, running: true };
  assert.equal(presentWorkGroup(input).summary.verb, "Working");
  const thinking = { kind: "thinking", runId: "run", attempt: 0, index: 0 } as const;
  const text = { ...thinking, kind: "text" } as const;
  assert.equal(
    presentWorkGroup({ ...input, live: { ...IDLE, order: [text, thinking] } }).summary.verb,
    "Thinking",
  );
  assert.equal(
    presentWorkGroup({ ...input, live: { ...IDLE, order: [thinking, text] } }).summary.verb,
    "Working",
  );
});
