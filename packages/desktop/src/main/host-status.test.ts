import assert from "node:assert/strict";
import { test } from "vitest";
import { readHostStatus, readHostUpdate, retiresHost } from "./host-status.ts";
import type { HostLinkState } from "../host/host-link.ts";
import type { HostProbe, HostReading, HostRetireProbe, HostUpdate } from "./host-status.ts";

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

const SERVING = 41;

const JOB = 42;

function connected(version: string, compatible = false): HostLinkState {
  return { kind: "connected", version, compatible };
}

const retires: readonly (readonly [string, HostRetireProbe, boolean])[] = [
  [
    "an updated app over the older host its own job runs",
    {
      link: connected("0.0.28"),
      appVersion: APP,
      serving: { pid: SERVING, own: true },
      job: SERVING,
    },
    true,
  ],
  [
    "a newer build over another build's host while its own host stands by",
    { link: connected("0.0.28"), appVersion: APP, serving: { pid: SERVING, own: false }, job: JOB },
    true,
  ],
  [
    "a newer build with no host of its own to take over",
    {
      link: connected("0.0.28"),
      appVersion: APP,
      serving: { pid: SERVING, own: false },
      job: null,
    },
    false,
  ],
  [
    "a detached host, which no job of the app's runs",
    {
      link: connected("0.0.28"),
      appVersion: APP,
      serving: { pid: SERVING, own: false },
      job: SERVING,
    },
    false,
  ],
  [
    "an older build over a newer host",
    { link: connected("0.0.30"), appVersion: APP, serving: { pid: SERVING, own: false }, job: JOB },
    false,
  ],
  [
    "the same version with other operations",
    { link: connected(APP), appVersion: APP, serving: { pid: SERVING, own: true }, job: SERVING },
    false,
  ],
  [
    "a nightly over the release it leads to",
    {
      link: connected("0.0.30"),
      appVersion: "0.0.30-nightly.2",
      serving: { pid: SERVING, own: false },
      job: JOB,
    },
    false,
  ],
  [
    "a release over its nightly",
    {
      link: connected("0.0.30-nightly.2"),
      appVersion: "0.0.30",
      serving: { pid: SERVING, own: false },
      job: JOB,
    },
    true,
  ],
  [
    "a nightly over an earlier nightly, by number",
    {
      link: connected("0.0.30-nightly.9"),
      appVersion: "0.0.30-nightly.10",
      serving: { pid: SERVING, own: false },
      job: JOB,
    },
    true,
  ],
  [
    "a version that is not semver",
    {
      link: connected("0.0.28"),
      appVersion: "dev",
      serving: { pid: SERVING, own: true },
      job: SERVING,
    },
    false,
  ],
  [
    "a host that stopped answering",
    {
      link: { kind: "unreachable", message: "gone" },
      appVersion: APP,
      serving: { pid: SERVING, own: true },
      job: SERVING,
    },
    false,
  ],
];

test("an app asks a host to retire only when the app is newer and its own host takes over", () => {
  assert.deepEqual(
    retires.map(([name, probe]) => [name, retiresHost(probe)]),
    retires.map(([name, , retired]) => [name, retired]),
  );
});

const BUILDS = ["0.0.28", APP, "0.0.30-nightly.9", "0.0.30-nightly.10", "0.0.30", "dev"] as const;

test("two builds sharing a home, each with its own host standing by, never both ask the other's host to retire", () => {
  const asks = (app: string, host: string): boolean =>
    retiresHost({
      link: connected(host),
      appVersion: app,
      serving: { pid: SERVING, own: false },
      job: JOB,
    });

  const both = BUILDS.flatMap((left) =>
    BUILDS.flatMap((right) => (asks(left, right) && asks(right, left) ? [[left, right]] : [])),
  );

  assert.deepEqual(both, []);
});
