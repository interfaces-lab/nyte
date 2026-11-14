import assert from "node:assert/strict";
import { test } from "vitest";
import type { HostProcess } from "../contract/bridge.ts";
import { hostToast } from "./host-events.ts";
import type { HostToast } from "./host-events.ts";

const CURRENT: HostProcess = { kind: "current", version: "1", startedAt: null };

const STALE: HostProcess = { kind: "stale", version: "1", startedAt: null };

const ROWS: readonly (readonly [
  boolean,
  boolean,
  "reply" | "event",
  HostProcess,
  HostToast,
  boolean,
])[] = [
  [false, false, "event", { kind: "restarting" }, "loading", true],
  [true, true, "event", { kind: "restarting" }, "loading", true],
  [true, true, "event", CURRENT, "restarted", false],
  [false, true, "event", CURRENT, "close", false],
  [true, true, "event", { kind: "offline" }, "none", true],
  [false, true, "event", { kind: "offline" }, "close", false],
  [true, true, "event", STALE, "close", false],
  [false, true, "event", STALE, "close", false],
  [false, false, "reply", CURRENT, "close", false],
  [false, false, "reply", { kind: "restarting" }, "loading", true],
  [true, true, "reply", CURRENT, "none", true],
  [false, true, "reply", { kind: "restarting" }, "none", false],
];

test("the restart toast loads through a restart, says so once the host is current, and ignores a reply older than an event", () => {
  for (const row of ROWS)
    assert.deepEqual(
      hostToast({ restarting: row[0], heard: row[1] }, row[2], row[3]),
      { restarting: row[5], heard: true, toast: row[4] },
      `${String(row[0])}, ${String(row[1])}, then a ${row[2]} of ${row[3].kind}`,
    );
});
