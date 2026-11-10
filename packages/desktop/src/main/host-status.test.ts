import assert from "node:assert/strict";
import { test } from "vitest";
import { readHostStatus, readHostUpdate } from "./host-status.ts";
import type { HostLinkState } from "./host-link.ts";
import type { HostProbe, HostReading, HostUpdate } from "./host-status.ts";

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

const APP = "0.0.29";

const updates: readonly (readonly [string, HostLinkState, HostUpdate])[] = [
  ["a host on the app's build", { kind: "connected", version: APP, compatible: true }, "current"],
  [
    "a host still on the build before an update",
    { kind: "connected", version: "0.0.28", compatible: false },
    "stale",
  ],
  [
    "an older version whose operations happen to match",
    { kind: "connected", version: "0.0.28", compatible: true },
    "stale",
  ],
  [
    "the same version with other operations",
    { kind: "connected", version: APP, compatible: false },
    "stale",
  ],
  ["a host still connecting", { kind: "connecting" }, "offline"],
  ["a host that stopped answering", { kind: "unreachable", message: "gone" }, "offline"],
];

test("a host on another build reads as stale, and the app never restarts it", () => {
  for (const [name, link, update] of updates)
    assert.equal(readHostUpdate({ link, appVersion: APP }), update, name);
});
