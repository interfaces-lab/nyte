import assert from "node:assert/strict";
import { test } from "vitest";
import type { HostProcess } from "../contract/bridge.ts";
import { hostToast } from "./host-events.ts";
import type { HostToast } from "./host-events.ts";

const CURRENT: HostProcess = { kind: "current", version: "1", startedAt: null };

const STALE: HostProcess = { kind: "stale", version: "1", startedAt: null };

const ROWS: readonly (readonly [boolean, HostProcess, HostToast, boolean])[] = [
  [false, { kind: "restarting" }, "loading", true],
  [true, { kind: "restarting" }, "loading", true],
  [true, CURRENT, "restarted", false],
  [false, CURRENT, "close", false],
  [true, { kind: "offline" }, "none", true],
  [false, { kind: "offline" }, "close", false],
  [true, STALE, "close", false],
  [false, STALE, "close", false],
];

test("the restart toast loads through a restart and says so once the host is current", () => {
  for (const row of ROWS)
    assert.deepEqual(
      hostToast(row[0], row[1]),
      { restarting: row[3], toast: row[2] },
      `${String(row[0])} then ${row[1].kind}`,
    );
});
