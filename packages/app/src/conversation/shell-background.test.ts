import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { Json, SessionView } from "@nyte-ai/sdk";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { settledTool } from "../../test/view-fixtures.ts";
import { findForegroundJobs } from "./shell-background.ts";

function openTool(
  id: string,
  phase: "calling" | "running" = "running",
  status: ToolMessage["status"] = { kind: "live", run: asId<"run">("run") },
): ToolMessage {
  const message = settledTool(id, { kind: "shell", command: "pnpm test" });
  const state = {
    call: message.state.call,
    name: message.state.name,
    args: message.state.args,
    class: message.state.class,
  };

  return {
    ...message,
    state: phase === "calling" ? { ...state, phase } : { ...state, phase, progress: null },
    status,
  };
}

const job = {
  kind: "job",
  id: "job-first",
  title: "Tests",
  state: "working",
  startedBy: asId<"call">("first"),
} satisfies SessionView["background"][number];

test("a foreground mapping appears only after its working background job arrives", () => {
  const messages = [openTool("first")];

  expect([...findForegroundJobs({ messages, background: [] })]).toEqual([]);
  expect([...findForegroundJobs({ messages, background: [job] })]).toEqual([
    ["job-first", "first"],
  ]);
  expect([...findForegroundJobs(undefined)]).toEqual([]);
});

test("completed, unowned and other background work do not expose a foreground action", () => {
  const messages = [openTool("first")];
  const irrelevant = [
    { ...job, id: "completed", state: "done" },
    { ...job, id: "failed", state: "failed" },
    { ...job, id: "unowned", startedBy: null },
    { ...job, id: "child", kind: "child" },
    { ...job, id: "page", kind: "page" },
  ] satisfies SessionView["background"];

  expect([...findForegroundJobs({ messages, background: [...irrelevant, job] })]).toEqual([
    ["job-first", "first"],
  ]);
  expect([...findForegroundJobs({ messages, background: irrelevant })]).toEqual([]);
});

test("only live running calls join their matching jobs", () => {
  const messages = [
    openTool("first"),
    openTool("second"),
    openTool("calling", "calling"),
    openTool("waiting", "running", {
      kind: "waiting",
      run: asId<"run">("run"),
      on: { kind: "part", part: asId<"part">("input") },
    }),
    settledTool("done", { kind: "shell", command: "pnpm test" }),
    openTool("nonlive", "running", {
      kind: "settled",
      commit: asId<"commit">("committed"),
      endedAt: 10,
    }),
    openTool("failed", "running", {
      kind: "failed",
      run: null,
      failure: { class: "provider", message: "Interrupted" },
    }),
  ];
  const background = [
    "second",
    "calling",
    "waiting",
    "first",
    "done",
    "nonlive",
    "failed",
    "missing",
  ].map((id) => ({ ...job, id: `job-${id}`, startedBy: asId<"call">(id) }));

  expect([...findForegroundJobs({ messages, background })]).toEqual([
    ["job-second", "second"],
    ["job-first", "first"],
  ]);
});

test("an invalid tool state cannot replace a validated foreground part", () => {
  const valid = openTool("first");
  const states: readonly Json[] = [
    null,
    false,
    "running",
    [],
    { phase: "running" },
    { ...valid.state, class: { kind: "unknown" } },
    { ...valid.state, progress: "invalid" },
  ];
  const invalid = states.map((state, index) => ({
    ...valid,
    id: asId<"message">(`invalid-${String(index)}`),
    part: asId<"part">(`invalid-${String(index)}`),
    state,
  }));

  expect([...findForegroundJobs({ messages: [valid, ...invalid], background: [job] })]).toEqual([
    ["job-first", "first"],
  ]);
});

test("a mapping follows the current job and call states without stale results", () => {
  const messages = [openTool("first")];
  const view = { messages, background: [job] };

  expect([...findForegroundJobs(view)]).toEqual([["job-first", "first"]]);
  expect([...findForegroundJobs({ ...view, background: [{ ...job, state: "done" }] })]).toEqual([]);
  expect([
    ...findForegroundJobs({
      ...view,
      messages: [settledTool("first", { kind: "shell", command: "pnpm test" })],
    }),
  ]).toEqual([]);
  expect([...findForegroundJobs(view)]).toEqual([["job-first", "first"]]);
});
