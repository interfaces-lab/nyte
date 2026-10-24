import { asId } from "@nyte-ai/schema";
import type { Execution, PartStatus, ToolClass, ToolOutcome, ToolPartState } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import {
  completionTrigger,
  executionMark,
  failureNotice,
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
  expect(executionMark(undefined)).toBe("idle");
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
