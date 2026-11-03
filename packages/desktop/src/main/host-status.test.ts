import assert from "node:assert/strict";
import { test } from "vitest";
import { readHostStatus } from "./host-status.ts";
import type { HostProbe, HostReading } from "./host-status.ts";

const rows: readonly (readonly [string, HostProbe, HostReading])[] = [
  [
    "no pid from launchd",
    { pid: null, alive: false, registration: "enabled", link: "unreachable" },
    { status: "stopped", issues: [] },
  ],
  [
    "a pid that is not alive",
    { pid: 41, alive: false, registration: "enabled", link: "connected" },
    { status: "stopped", issues: [] },
  ],
  [
    "stopped while waiting for approval",
    { pid: null, alive: false, registration: "requires-approval", link: "unreachable" },
    { status: "stopped", issues: ["approval"] },
  ],
  [
    "alive and connected",
    { pid: 41, alive: true, registration: "enabled", link: "connected" },
    { status: "running", issues: [] },
  ],
  [
    "alive while the first connection is still opening",
    { pid: 41, alive: true, registration: "enabled", link: "connecting" },
    { status: "running", issues: [] },
  ],
  [
    "alive but the app cannot connect",
    { pid: 41, alive: true, registration: "enabled", link: "unreachable" },
    { status: "issues", issues: ["unreachable"] },
  ],
  [
    "alive and the agent requires approval",
    { pid: 41, alive: true, registration: "requires-approval", link: "connected" },
    { status: "issues", issues: ["approval"] },
  ],
  [
    "alive, unapproved and unreachable",
    { pid: 41, alive: true, registration: "requires-approval", link: "unreachable" },
    { status: "issues", issues: ["approval", "unreachable"] },
  ],
];

test("the host status comes from the process, the registration and the connection", () => {
  for (const [name, probe, reading] of rows) assert.deepEqual(readHostStatus(probe), reading, name);
});
