import assert from "node:assert/strict";
import { test } from "vitest";
import { readHostStatus, readHostUpdate } from "./host-status.ts";
import type { HostProbe, HostReading, HostUpdate, HostUpdateProbe } from "./host-status.ts";

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

const updates: readonly (readonly [string, Omit<HostUpdateProbe, "appVersion">, HostUpdate])[] = [
  [
    "the app's own host on the app's build",
    { link: { kind: "connected", version: APP, compatible: true }, own: true, restarted: false },
    "current",
  ],
  [
    "the app's own host still on the build before an update",
    {
      link: { kind: "connected", version: "0.0.28", compatible: false },
      own: true,
      restarted: false,
    },
    "restart",
  ],
  [
    "an older version whose operations happen to match",
    {
      link: { kind: "connected", version: "0.0.28", compatible: true },
      own: true,
      restarted: false,
    },
    "restart",
  ],
  [
    "the same version with other operations",
    { link: { kind: "connected", version: APP, compatible: false }, own: true, restarted: false },
    "restart",
  ],
  [
    "still on another build after this launch restarted it",
    {
      link: { kind: "connected", version: "0.0.28", compatible: true },
      own: true,
      restarted: true,
    },
    "stale",
  ],
  [
    "a host another install serves",
    {
      link: { kind: "connected", version: "0.0.28", compatible: false },
      own: false,
      restarted: false,
    },
    "stale",
  ],
  [
    "another install's host on the app's build",
    { link: { kind: "connected", version: APP, compatible: true }, own: false, restarted: false },
    "current",
  ],
  [
    "a host still connecting",
    { link: { kind: "connecting" }, own: true, restarted: false },
    "offline",
  ],
  [
    "a host that stopped answering",
    { link: { kind: "unreachable", message: "gone" }, own: true, restarted: true },
    "offline",
  ],
];

test("an update restarts the app's own host once, and any other stale host waits", () => {
  for (const [name, probe, update] of updates)
    assert.equal(readHostUpdate({ ...probe, appVersion: APP }), update, name);
});
