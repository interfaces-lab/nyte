import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { Execution } from "@nyte-ai/sdk";
import { chatsFor, sessionRow } from "../../../test/view-fixtures.ts";
import { listSubagents } from "./agents.tsx";

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

test("the agents tray keeps a failed agent listed after those waiting on the user, and drops settled ones", () => {
  const working = sessionRow(
    "working",
    { parent, lastActivityAt: 5 },
    { kind: "live", run, phase: "responding", stopping: false },
  );

  const approval = sessionRow(
    "approval",
    { parent, lastActivityAt: 1 },
    { kind: "waiting", run, on: { kind: "part", part: asId<"part">("p") } },
  );

  const failed = sessionRow("failed", { parent, lastActivityAt: 3 }, FAILED);

  const stopped = sessionRow(
    "stopped",
    { parent },
    { kind: "idle", lastRun: { id: run.id, end: { kind: "stopped" }, endedAt: 2 } },
  );

  const completed = sessionRow("completed", { parent });
  const agents = [working, approval, failed, stopped, completed];
  const chats = chatsFor(agents);
  const closed = listSubagents(agents, { kind: "closed" }, chats);

  expect(closed.listed.map((agent) => agent.title)).toEqual(["approval", "working", "failed"]);
  expect(closed.active.map((agent) => agent.title)).toEqual(["approval", "working"]);

  expect(closed.listed.map((agent) => agent.status.kind)).toEqual([
    "waiting-for-approval",
    "working",
    "failed",
  ]);

  const held = listSubagents(
    agents,
    { kind: "list", retainedSessionId: stopped.id, openedOver: [stopped.id] },
    chats,
  );

  expect(held.listed.at(-1)).toMatchObject({ title: "stopped", status: { kind: "stopped" } });
});
