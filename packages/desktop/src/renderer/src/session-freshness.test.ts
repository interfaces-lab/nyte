import assert from "node:assert/strict";
import { test } from "vitest";
import type { SessionInfo } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/core";
import { SessionObservations } from "./session-freshness.ts";

const id = sessionId("s1");

function row(phase: "tools" | "done"): SessionInfo {
  return {
    sessionId: id,
    activation: { kind: "active" },
    createdAt: 0,
    lastActivityAt: 0,
    pinned: false,
    archived: false,
    heads: [
      {
        head: "main",
        tip: null,
        run: {
          runId: "r1",
          head: "main",
          phase: phase === "done" ? { kind: "done" } : { kind: "tools" },
          startedAt: 0,
          attempts: 1,
          config: {},
        },
      },
    ],
    config: {},
  };
}

test("a poll that started before the run event yields to the event's row", () => {
  const observations = new SessionObservations();
  const pollStartedAt = 100;
  observations.observe(id, 150);
  const cached = row("done");
  assert.equal(observations.freshest(row("tools"), pollStartedAt, cached), cached);
});

test("a poll that started after the last observation is believed", () => {
  const observations = new SessionObservations();
  observations.observe(id, 50);
  const polled = row("tools");
  assert.equal(observations.freshest(polled, 100, row("done")), polled);
});

test("a session never observed live is taken from the poll", () => {
  const observations = new SessionObservations();
  const polled = row("done");
  assert.equal(observations.freshest(polled, 100, undefined), polled);
});
