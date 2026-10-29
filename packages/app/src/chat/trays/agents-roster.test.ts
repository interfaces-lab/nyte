import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { BackgroundItem, Execution, SessionInfo } from "@nyte-ai/sdk";
import { chatsFor, sessionRow } from "../../../test/view-fixtures.ts";
import { describeTask, trayTasks } from "../../chats/tasks.ts";
import type { Task } from "../../chats/tasks.ts";

const run = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 1,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("m") },
} as const;

const FAILED: Execution = {
  kind: "idle",
  lastRun: {
    id: run.id,
    end: { kind: "failed", failure: { class: "provider", message: "Rate limited." } },
    endedAt: 2,
  },
};

const parent = asId<"session">("parent");

test("the agents tray lists every agent still going and each ended one until it is cleared, those waiting on the user first", () => {
  const working = sessionRow(
    "working",
    { parent },
    { kind: "live", run, phase: "responding", stopping: false },
  );

  const approval = sessionRow(
    "approval",
    { parent },
    { kind: "waiting", run, on: { kind: "part", part: asId<"part">("p") } },
  );

  const failed = sessionRow("failed", { parent }, FAILED);

  const stopped = sessionRow(
    "stopped",
    { parent },
    { kind: "idle", lastRun: { id: run.id, end: { kind: "stopped" }, endedAt: 2 } },
  );

  const completed = sessionRow("completed", { parent });
  const agents = [working, approval, failed, stopped, completed];
  const chats = chatsFor(agents);

  const item = (session: SessionInfo): BackgroundItem => ({
    kind: "child",
    id: session.id,
    title: "Subagent",
    state: "done",
    startedBy: null,
  });

  const tasks = agents.flatMap((agent): readonly Task[] => {
    const task = describeTask(item(agent), chats.get(agent.id), undefined);

    return task === undefined ? [] : [task];
  });
  const listed = trayTasks(tasks, new Set());

  expect(listed.map((task) => [task.title, task.state])).toEqual([
    ["approval", "waiting"],
    ["working", "working"],
    ["completed", "done"],
    ["stopped", "done"],
    ["failed", "failed"],
  ]);

  expect(
    trayTasks(tasks, new Set([stopped.id, completed.id, working.id])).map((task) => task.title),
    "clearing keeps what still goes and what wasn't cleared",
  ).toEqual(["approval", "working", "failed"]);
});
