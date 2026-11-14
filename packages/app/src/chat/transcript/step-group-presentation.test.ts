import assert from "node:assert/strict";
import { test } from "vitest";
import type { PartStatus, ToolClass, ToolPartState } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { planningLabel } from "@nyte-ai/plugin/client/presentation";
import { stepGroupFacts, stepGroupLine } from "./step-group-presentation.ts";
import type { StepMessage } from "./transcript-presentation.ts";

type Outcome = Extract<ToolPartState, { readonly phase: "settled" }>["outcome"] | "running";

const SUCCESS: Outcome = { kind: "ok", content: [], output: null, parts: [] };

const EXIT: Outcome = { kind: "failed", message: "exit 1" };

const DENIED: Outcome = { kind: "rejected", reason: "denied" };

const STOPPED: Outcome = { kind: "stopped" };

const SETTLED: PartStatus = { kind: "settled", commit: asId<"commit">("c"), endedAt: 1 };

let calls = 0;

function call(toolClass: ToolClass, outcome: Outcome): StepMessage {
  calls += 1;
  const id = `call-${String(calls)}`;
  const base = { call: asId<"call">(id), name: toolClass.kind, args: null, class: toolClass };

  return {
    id: asId<"message">(id),
    turn: asId<"turn">("turn"),
    at: calls,
    kind: "part",
    part: asId<"part">(id),
    partKind: "tool",
    role: "step",
    version: 1,
    ...(outcome === "running"
      ? {
          state: { ...base, phase: "running", progress: null },
          status: { kind: "live", run: asId<"run">("run") },
        }
      : { state: { ...base, phase: "settled", outcome, changes: null }, status: SETTLED }),
  };
}

const shell = (command: string, outcome: Outcome) => call({ kind: "shell", command }, outcome);

function thought(live: boolean): StepMessage {
  calls += 1;
  const id = `thought-${String(calls)}`;

  return {
    id: asId<"message">(id),
    turn: asId<"turn">("turn"),
    at: calls,
    kind: "part",
    part: asId<"part">(id),
    partKind: "thinking",
    role: "step",
    version: 1,
    state: { markdown: "Weighing the next step", merged: 1, signature: null },
    status: live ? { kind: "live", run: asId<"run">("run") } : SETTLED,
  };
}

function line(messages: readonly StepMessage[], running: boolean) {
  return stepGroupLine({ messages, durationMs: 0, running });
}

function liveLine(messages: readonly StepMessage[]) {
  const live = line(messages, true);

  return live.kind === "summary" ? [live.verb, live.detail].filter(Boolean).join(" ") : live;
}

function summary(messages: readonly StepMessage[]) {
  const settled = line(messages, false);

  assert.equal(settled.kind, "summary");

  return settled.kind === "summary" ? settled : undefined;
}

test.each<{
  readonly name: string;
  readonly messages: readonly StepMessage[];
  readonly verb: string;
  readonly detail: string | undefined;
}>([
  {
    name: "a step whose calls all succeeded keeps its verb",
    messages: [shell("pnpm test", SUCCESS), shell("pnpm lint", SUCCESS)],
    verb: "Ran",
    detail: "2 commands",
  },
  {
    name: "a step that lost a call tallies each outcome instead of claiming a verb",
    messages: [shell("pnpm test", SUCCESS), shell("pnpm lint", SUCCESS), shell("rm -rf /", DENIED)],
    verb: "2 commands succeeded, 1 failed",
    detail: undefined,
  },
  {
    name: "a step with mixed calls tallies every outcome",
    messages: [
      call({ kind: "read", path: "/w/a.ts" }, SUCCESS),
      shell("pnpm test", EXIT),
      shell("pnpm build", STOPPED),
      shell("sleep 1", STOPPED),
    ],
    verb: "1 file read, 1 failed, 2 stopped",
    detail: undefined,
  },
  {
    name: "a step whose every call failed or stopped never merges the two",
    messages: [shell("a", EXIT), shell("b", STOPPED)],
    verb: "1 call failed, 1 stopped",
    detail: undefined,
  },
  {
    name: "a denial counts as a failure",
    messages: [shell("a", EXIT), shell("b", DENIED)],
    verb: "2 calls failed",
    detail: undefined,
  },
  {
    name: "a step whose every call stopped says so",
    messages: [shell("a", STOPPED), shell("b", STOPPED)],
    verb: "2 calls stopped",
    detail: undefined,
  },
  {
    name: "a finished step counts each path once",
    messages: [
      call({ kind: "read", path: "/w/a.ts" }, SUCCESS),
      call({ kind: "read", path: "/w/a.ts" }, SUCCESS),
      call({ kind: "list", path: "/w" }, SUCCESS),
    ],
    verb: "Explored",
    detail: "1 directory, 1 file",
  },
])("$name", (row) => {
  assert.deepEqual(summary(row.messages), { kind: "summary", verb: row.verb, detail: row.detail });
});

test("a live step counts its calls under the group's verb, which only climbs", () => {
  const a = call({ kind: "read", path: "/w/a.ts" }, SUCCESS);
  const b = call({ kind: "read", path: "/w/b.ts" }, "running");

  assert.equal(liveLine([a]), "Exploring a.ts");
  assert.equal(liveLine([a, b]), "Exploring 2 files");
  assert.equal(liveLine([a, b, shell("pnpm test", "running")]), "Exploring 2 files, ran 1 command");
  assert.equal(
    liveLine([a, b, shell("pnpm test", SUCCESS), thought(true)]),
    "Exploring 2 files, ran 1 command",
  );
  assert.equal(
    liveLine([
      a,
      call({ kind: "edit", path: "/w/lease.ts" }, "running"),
      shell("pnpm lint", SUCCESS),
    ]),
    "Editing lease.ts, explored a.ts, ran 1 command",
  );
  assert.equal(
    liveLine([shell("pnpm test", SUCCESS), shell("pnpm lint", "running")]),
    "Running 2 commands",
  );
});

test("a live step leaves failed calls out of its counts until it settles", () => {
  const steps = [call({ kind: "read", path: "/w/a.ts" }, SUCCESS), shell("pnpm test", EXIT)];

  assert.equal(liveLine(steps), "Exploring a.ts");
  assert.equal(summary(steps)?.verb, "1 file read, 1 failed");
});

test("a live step without calls is thinking, and once it settles it reads as a thought, never as planning", () => {
  assert.deepEqual(line([thought(true)], true), { kind: "thinking" });
  assert.deepEqual(summary([thought(false)]), {
    kind: "summary",
    verb: "Thought",
    detail: undefined,
  });
});

test("the live row plans after 200 ms and slows at 15 s", () => {
  assert.equal(planningLabel(0), undefined);
  assert.equal(planningLabel(199), undefined);
  assert.equal(planningLabel(200), "Planning next moves");
  assert.equal(planningLabel(14_999), "Planning next moves");
  assert.equal(planningLabel(15_000), "Taking longer than expected…");
});

function thoughtAt(markdown: string, at: number, endedAt: number | undefined): StepMessage {
  const message = { ...thought(endedAt === undefined), at };
  const state = { markdown, merged: 1, signature: null };

  if (endedAt === undefined) return { ...message, state };

  return { ...message, state, status: { kind: "settled", commit: asId<"commit">("c"), endedAt } };
}

test.each<{
  readonly name: string;
  readonly messages: readonly StepMessage[];
  readonly running: boolean;
  readonly facts: Omit<ReturnType<typeof stepGroupFacts>, "entries"> & { readonly entries: number };
}>([
  {
    name: "a settled thought is titled by its heading and timed from its start to its end",
    messages: [thoughtAt("**Checking the lease**\n\nThe lease is fine.", 1_000, 3_500)],
    running: false,
    facts: {
      entries: 1,
      line: { kind: "summary", verb: "Checking the lease", detail: "3s" },
      thinkingOnly: true,
      titled: true,
      hasContent: true,
    },
  },
  {
    name: "a settled thought under half a second shows no time",
    messages: [thoughtAt("Weighing it", 1_000, 1_499)],
    running: false,
    facts: {
      entries: 1,
      line: { kind: "summary", verb: "Thought", detail: undefined },
      thinkingOnly: true,
      titled: true,
      hasContent: true,
    },
  },
  {
    name: "a settled thought that is only a heading has nothing to open",
    messages: [thoughtAt("**Only a heading**", 1_000, 3_500)],
    running: false,
    facts: {
      entries: 1,
      line: { kind: "summary", verb: "Only a heading", detail: "3s" },
      thinkingOnly: true,
      titled: true,
      hasContent: false,
    },
  },
  {
    name: "a running thought, however old, is thinking and untitled",
    messages: [thoughtAt("**Checking the lease**", -1_000_000_000, undefined)],
    running: true,
    facts: {
      entries: 1,
      line: { kind: "thinking" },
      thinkingOnly: true,
      titled: false,
      hasContent: true,
    },
  },
  {
    name: "thoughts alone stay apart, and two settled thoughts are not titled",
    messages: [thoughtAt("First", 1_000, 2_000), thoughtAt("Second", 2_000, 4_000)],
    running: false,
    facts: {
      entries: 2,
      line: { kind: "summary", verb: "Thought", detail: "3s" },
      thinkingOnly: true,
      titled: false,
      hasContent: true,
    },
  },
  {
    name: "thoughts beside a call merge, and a blank thought is dropped",
    messages: [
      thoughtAt("First", 1_000, 2_000),
      thoughtAt("Second", 2_000, 3_000),
      thoughtAt(" ", 3_000, 3_000),
      call({ kind: "read", path: "/w/a.ts" }, SUCCESS),
    ],
    running: false,
    facts: {
      entries: 2,
      line: { kind: "summary", verb: "Explored", detail: "a.ts" },
      thinkingOnly: false,
      titled: false,
      hasContent: true,
    },
  },
  {
    name: "a running group's line ignores its age",
    messages: [call({ kind: "read", path: "/w/a.ts" }, "running")],
    running: true,
    facts: {
      entries: 1,
      line: { kind: "summary", verb: "Exploring", detail: "a.ts" },
      thinkingOnly: false,
      titled: false,
      hasContent: true,
    },
  },
  {
    name: "an empty group has nothing to open",
    messages: [],
    running: false,
    facts: {
      entries: 0,
      line: { kind: "summary", verb: "Thought", detail: undefined },
      thinkingOnly: true,
      titled: false,
      hasContent: false,
    },
  },
])("$name", (row) => {
  const facts = stepGroupFacts(row.messages, row.running);

  assert.deepEqual({ ...facts, entries: facts.entries.length }, row.facts);
});
