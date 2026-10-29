import { asId } from "@nyte-ai/schema";
import type { Execution, PartStatus, ToolClass, ToolOutcome, ToolPartState } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import {
  backgroundLabel,
  completionTrigger,
  executionMark,
  failureNotice,
  rowMark,
  runMark,
  runStatus,
  sessionTitle,
  taskLabel,
  toolOutput,
  toolStatus,
  toolTitle,
} from "../src/client/presentation.ts";

const READ: ToolClass = { kind: "read", path: "/repo/src/app.ts" };

const live: PartStatus = { kind: "live", run: asId("run") };

function running(toolClass: ToolClass): ToolPartState {
  return {
    call: asId("call"),
    name: "tool",
    args: {},
    class: toolClass,
    phase: "running",
    progress: null,
  };
}

function settled(outcome: ToolOutcome, toolClass: ToolClass = READ): ToolPartState {
  return { ...running(toolClass), phase: "settled", outcome, changes: null };
}

function cutOff(failure: "aborted" | "network"): PartStatus {
  return { kind: "failed", run: asId("run"), failure: { class: failure, message: "" } };
}

it("reads an open call cut off by its run as stopped or interrupted, never failed", () => {
  expect(toolStatus({ state: running(READ), status: cutOff("aborted") })).toEqual({
    tense: "none",
    tone: "stopped",
    word: "Stopped",
  });

  expect(toolStatus({ state: running(READ), status: cutOff("network") })).toEqual({
    tense: "none",
    tone: "stopped",
    word: "Interrupted",
  });
});

it("reads a settled call by its outcome whatever happened to the run", () => {
  const ok = settled({ kind: "ok", content: [], output: null, parts: [] });

  expect(toolStatus({ state: ok, status: cutOff("network") }).tone).toBe("success");
  expect(toolStatus({ state: settled({ kind: "failed", message: "boom" }), status: live })).toEqual(
    { tense: "none", tone: "failure", word: "Failed" },
  );
  expect(
    toolStatus({ state: settled({ kind: "rejected", reason: "no" }), status: live }).word,
  ).toBe("Blocked");
});

it("asks for input while the run waits on the part", () => {
  const status: PartStatus = {
    kind: "waiting",
    run: asId("run"),
    on: { kind: "part", part: asId("part") },
  };

  expect(toolStatus({ state: running(READ), status })).toEqual({
    tense: "running",
    tone: "attention",
    word: "Needs input",
  });
});

it("joins a settled call's text content and skips empty text", () => {
  const state = settled({
    kind: "ok",
    content: [
      { kind: "text", text: "one" },
      { kind: "text", text: "" },
      { kind: "text", text: "two" },
    ],
    output: null,
    parts: [],
  });

  expect(toolOutput(state)).toBe("one\ntwo");
  expect(toolOutput(running(READ))).toBe("");
});

it("titles a call with its tense's verb, or its subject and noun without one", () => {
  expect(toolTitle(READ, "running")).toBe("Reading /repo/src/app.ts");
  expect(toolTitle(READ, "none", "app.ts")).toBe("app.ts read");

  const send: ToolClass = { kind: "delegate", child: null, role: "send", title: "review" };

  expect(toolTitle(send, "past")).toBe("Messaged review");
  expect(toolTitle(send, "none")).toBe("review message");
  expect(toolTitle({ kind: "custom", label: "mcp__github__list_issues" }, "past")).toBe(
    "Ran list_issues in github",
  );
  expect(toolTitle({ kind: "custom", label: "websearch" }, "none")).toBe("websearch");
});

it("names a recovery step for the failures the user can fix", () => {
  expect(failureNotice({ class: "context_window", message: "" }).recovery).toBe("compact");
  expect(failureNotice({ class: "auth", message: "" }).recovery).toBe("sign-in");
  expect(failureNotice({ class: "quota", message: "" }).recovery).toBe("switch-model");
  expect(failureNotice({ class: "aborted", message: "" })).toEqual({
    text: "Run stopped.",
    tone: "neutral",
    recovery: undefined,
  });
  expect(failureNotice({ class: "provider", message: "  bad\n  gateway " }).text).toBe(
    "bad gateway",
  );
});

it("marks a session failed only when its last run failed", () => {
  const failed: Execution = {
    kind: "idle",
    lastRun: {
      id: asId("run"),
      end: { kind: "failed", failure: { class: "network", message: "" } },
      endedAt: 0,
    },
  };

  expect(executionMark(failed)).toBe("failed");
  expect(executionMark(undefined)).toBe("done");
});

function ended(end: Extract<Execution, { kind: "idle" }>["lastRun"]): Execution {
  return { kind: "idle", lastRun: end };
}

it("keeps a run's outcome and an approval wait apart, and draws background work only after the run", () => {
  const run = { id: asId<"run">("run"), head: asId<"head">("main"), startedAt: 0, attempt: 1 };
  const started = { ...run, origin: { kind: "input", message: asId<"message">("m") } } as const;

  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: null,
    total: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  const failure = { class: "network", message: "Offline." } as const;

  const completed = ended({ id: run.id, end: { kind: "completed", usage }, endedAt: 1 });
  const stopped = ended({ id: run.id, end: { kind: "stopped" }, endedAt: 1 });
  const failed = ended({ id: run.id, end: { kind: "failed", failure }, endedAt: 1 });

  const responding: Execution = {
    kind: "live",
    run: started,
    phase: "responding",
    stopping: true,
  };

  const part = { kind: "part", part: asId<"part">("p") } as const;
  const approval: Execution = { kind: "waiting", run: started, on: part };
  const child = { kind: "run", session: asId<"session">("c"), run: run.id } as const;
  const delegating: Execution = { kind: "waiting", run: started, on: child };
  const retrying: Execution = { kind: "retrying", run: started, until: 2, reason: "Busy" };

  const cases: readonly [Execution | undefined, string, string][] = [
    [undefined, "idle", "done"],
    [ended(null), "idle", "done"],
    [completed, "completed", "done"],
    [stopped, "stopped", "done"],
    [failed, "failed", "failed"],
    [responding, "working", "working"],
    [delegating, "working", "working"],
    [approval, "waiting-for-approval", "waiting"],
    [retrying, "retrying", "retrying"],
  ];

  for (const [execution, kind, mark] of cases) {
    const status = runStatus(execution);

    expect([status.kind, runMark(status)]).toEqual([kind, mark]);
    expect(executionMark(execution)).toBe(mark);
  }

  const none = { working: 0, waiting: 0 };
  const working = { working: 2, waiting: 0 };
  const asking = { working: 1, waiting: 1 };

  const rows: readonly [Execution, typeof none, string][] = [
    [completed, none, "done"],
    [completed, working, "background"],
    [failed, working, "failed"],
    [failed, asking, "waiting"],
    [stopped, asking, "waiting"],
    [responding, asking, "working"],
    [approval, working, "waiting"],
    [retrying, working, "retrying"],
  ];

  expect(rows.map(([execution, background]) => rowMark(runStatus(execution), background))).toEqual(
    rows.map(([, , mark]) => mark),
  );
  expect([none, working, asking].map(backgroundLabel)).toEqual([
    undefined,
    "2 working in the background",
    "Needs attention in the background",
  ]);

  expect(runStatus(responding)).toEqual({ kind: "working", run: run.id, stopping: true });
  expect(runStatus(approval)).toEqual({ kind: "waiting-for-approval", run: run.id });
  expect(runStatus(failed)).toEqual({ kind: "failed", failure });

  expect(
    rows.map(([execution, background]) => taskLabel(rowMark(runStatus(execution), background))),
  ).toEqual([
    "Done",
    "Working in the background",
    "Failed",
    "Needs attention",
    "Needs attention",
    "Working",
    "Needs attention",
    "Retrying",
  ]);
});

it("titles an unnamed root a new chat and an unnamed child a subagent", () => {
  expect(sessionTitle({ name: "Release", parent: null })).toBe("Release");
  expect(sessionTitle({ name: null, parent: null })).toBe("New chat");
  expect(sessionTitle({ name: null, parent: asId("root") })).toBe("Subagent");
});

it("finds the mention or command around the caret", () => {
  expect(completionTrigger("look at @src/ap", 15)).toEqual({
    kind: "@",
    start: 8,
    end: 15,
    query: "src/ap",
  });
  expect(completionTrigger("plain words")).toBeUndefined();
});
