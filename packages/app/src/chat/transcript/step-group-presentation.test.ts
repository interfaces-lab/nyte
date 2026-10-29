import assert from "node:assert/strict";
import { test } from "vitest";
import type { PartStatus, ToolClass, ToolPartState } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { liveStatusLabel, stepGroupLine } from "./step-group-presentation.ts";
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

test("a step whose calls all succeeded keeps its verb", () => {
  assert.deepEqual(summary([shell("pnpm test", SUCCESS), shell("pnpm lint", SUCCESS)]), {
    kind: "summary",
    verb: "Ran",
    detail: "2 commands",
  });
});

test("a step that lost a call tallies each outcome instead of claiming a verb", () => {
  assert.equal(
    summary([shell("pnpm test", SUCCESS), shell("pnpm lint", SUCCESS), shell("rm -rf /", DENIED)])
      ?.verb,
    "2 commands succeeded, 1 failed",
  );

  const mixed = summary([
    call({ kind: "read", path: "/w/a.ts" }, SUCCESS),
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

test("a finished step counts each path once", () => {
  const read = { kind: "read", path: "/w/a.ts" } as const;

  assert.deepEqual(
    summary([
      call(read, SUCCESS),
      call(read, SUCCESS),
      call({ kind: "list", path: "/w" }, SUCCESS),
    ]),
    { kind: "summary", verb: "Explored", detail: "1 directory, 1 file" },
  );
});

test("a live step without calls names what the agent is doing", () => {
  assert.deepEqual(line([thought(true)], true), { kind: "status", status: "thinking" });
  assert.deepEqual(line([thought(false)], true), { kind: "status", status: "planning" });
  assert.equal(liveStatusLabel("thinking", 20_000), "Thinking");
});

test("a live step with nothing in flight plans after 200 ms and slows at 15 s", () => {
  assert.equal(liveStatusLabel("planning", 0), undefined);
  assert.equal(liveStatusLabel("planning", 199), undefined);
  assert.equal(liveStatusLabel("planning", 200), "Planning next moves");
  assert.equal(liveStatusLabel("planning", 14_999), "Planning next moves");
  assert.equal(liveStatusLabel("planning", 15_000), "Taking longer than expected…");
});
