import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { Execution, SessionInfo } from "@nyte-ai/sdk/client";
import { busyTaskCount } from "./update-activity.ts";

const RUN = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 1,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("m") },
} as const;

const idle: Execution = { kind: "idle", lastRun: null };

const live: Execution = { kind: "live", run: RUN, phase: "responding", stopping: false };

const retrying: Execution = { kind: "retrying", run: RUN, until: 5, reason: "Overloaded" };

const waiting: Execution = { kind: "waiting", run: RUN, on: { kind: "part", part: asId("p1") } };

function chat(
  id: string,
  executions: readonly Execution[],
  session: Partial<SessionInfo> = {},
): SessionInfo {
  return {
    id: asId<"session">(id),
    name: id,
    parent: null,
    call: null,
    workspace: asId<"workspace">("w"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: executions.map((execution, index) => ({
      name: asId<"head">(index === 0 ? "main" : `side-${index}`),
      tip: { kind: "commit", id: asId<"commit">("tip") },
      stack: null,
      execution,
      unread: false,
      background: { working: 0, waiting: 0 },
    })),
    createdAt: 1,
    lastActivityAt: 1,
    ...session,
  };
}

test.each<{ readonly name: string; readonly rows: readonly SessionInfo[]; readonly count: number }>(
  [
    { name: "no chats", rows: [], count: 0 },
    {
      name: "idle chats and a chat with no heads",
      rows: [chat("a", [idle]), chat("b", [])],
      count: 0,
    },
    {
      name: "a live, a retrying and a waiting chat each count",
      rows: [chat("a", [live]), chat("b", [retrying]), chat("c", [waiting]), chat("d", [idle])],
      count: 3,
    },
    {
      name: "a chat with two busy heads counts once",
      rows: [chat("a", [live, waiting])],
      count: 1,
    },
    {
      name: "a chat whose only busy head isn't main counts",
      rows: [chat("a", [idle, live])],
      count: 1,
    },
    {
      name: "archived chats and subagents count too",
      rows: [
        chat("a", [live], { archived: true }),
        chat("b", [waiting], { parent: asId<"session">("a") }),
      ],
      count: 2,
    },
  ],
)("busy tasks: $name", (row) => {
  expect(busyTaskCount(row.rows)).toBe(row.count);
});
