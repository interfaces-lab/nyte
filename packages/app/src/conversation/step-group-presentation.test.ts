import assert from "node:assert/strict";
import { test } from "vitest";
import type { PartStatus, ToolClass, ToolPartState } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import {
  durableStepGroupPresentation,
  liveStatusLabel,
  liveStepGroupPresentation,
} from "./step-group-presentation.ts";
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

function liveLabel(messages: readonly StepMessage[], planningMs: number) {
  const presentation = liveStepGroupPresentation({
    durable: durableStepGroupPresentation({
      messages,
      durationMs: 0,
      added: 0,
      removed: 0,
      running: true,
    }),
    messages,
  });

  assert.equal(presentation.active, true);

  return presentation.active ? liveStatusLabel(presentation.status, planningMs) : undefined;
}

function summary(messages: readonly StepMessage[]) {
  const presentation = durableStepGroupPresentation({
    messages,
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

test("a live step names the call in flight, newest first, over thinking", () => {
  assert.equal(liveLabel([call({ kind: "read", path: "/w/a.ts" }, "running")], 0), "Exploring");
  assert.equal(liveLabel([call({ kind: "list", path: "/w" }, "running")], 0), "Exploring");
  assert.equal(
    liveLabel([shell("pnpm test", SUCCESS), shell("pnpm lint", "running")], 0),
    "Running",
  );
  assert.equal(
    liveLabel([call({ kind: "edit", path: "/w/a.ts" }, "running"), shell("pnpm lint", SUCCESS)], 0),
    "Editing",
  );
  assert.equal(liveLabel([shell("pnpm test", "running"), thought(true)], 0), "Running");
  assert.equal(liveLabel([shell("pnpm test", SUCCESS), thought(true)], 20_000), "Thinking");
});

test("a live step with nothing in flight plans after 200 ms and slows at 15 s", () => {
  const settled = [shell("pnpm test", SUCCESS), thought(false)];

  assert.equal(liveLabel(settled, 0), undefined);
  assert.equal(liveLabel(settled, 199), undefined);
  assert.equal(liveLabel(settled, 200), "Planning next moves");
  assert.equal(liveLabel(settled, 14_999), "Planning next moves");
  assert.equal(liveLabel(settled, 15_000), "Taking longer than expected…");
});

test("a running step lists only the calls still open", () => {
  const presentation = durableStepGroupPresentation({
    messages: [shell("pnpm test", SUCCESS), shell("pnpm lint", "running")],
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
