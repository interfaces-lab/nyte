import { expect, test } from "vitest";
import { SdkError } from "@nyte-ai/schema";
import type { HostProcess } from "@nyte-ai/app/contract/bridge.ts";
import type { LinkState } from "@nyte-ai/sdk/client";
import { readHostProcess, readHostStatus } from "./host-status.ts";
import type { HostProbe, HostReading } from "./host-status.ts";

function open(match: Extract<LinkState, { readonly kind: "open" }>["match"]): LinkState {
  return { kind: "open", since: 1, version: "0.0.29", startedAt: 5, match };
}

function away(reason: Extract<LinkState, { readonly kind: "away" }>["reason"]): LinkState {
  return { kind: "away", since: 1, retryAt: 2, reason };
}

function refused(reason: Extract<LinkState, { readonly kind: "refused" }>["reason"]): LinkState {
  return { kind: "refused", reason, error: new SdkError("not_supported", "No.") };
}

const ALIVE = { pid: 41, alive: true, registration: "enabled" } as const;

const rows: readonly {
  readonly name: string;
  readonly probe: HostProbe;
  readonly tray: HostReading;
  readonly settings: HostProcess;
}[] = [
  {
    name: "the app's own build, running",
    probe: { ...ALIVE, link: open({ kind: "current" }) },
    tray: { status: "running", issues: [] },
    settings: { kind: "current", version: "0.0.29", startedAt: 5 },
  },
  {
    name: "an older host that replaces itself once idle",
    probe: { ...ALIVE, link: open({ kind: "host-older", replace: "when-idle" }) },
    tray: { status: "running", issues: [] },
    settings: { kind: "current", version: "0.0.29", startedAt: 5 },
  },
  {
    name: "an older host only a restart replaces",
    probe: { ...ALIVE, link: open({ kind: "host-older", replace: "manual" }) },
    tray: { status: "running", issues: [] },
    settings: { kind: "stale", version: "0.0.29", startedAt: 5 },
  },
  {
    name: "a newer host",
    probe: { ...ALIVE, link: open({ kind: "host-newer" }) },
    tray: { status: "running", issues: [] },
    settings: { kind: "current", version: "0.0.29", startedAt: 5 },
  },
  {
    name: "a host replacing itself, its process gone for now",
    probe: { pid: null, alive: false, registration: "enabled", link: away("replacing") },
    tray: { status: "restarting", issues: [] },
    settings: { kind: "restarting" },
  },
  {
    name: "a host restarting its worker",
    probe: { ...ALIVE, link: away("restarting") },
    tray: { status: "restarting", issues: [] },
    settings: { kind: "restarting" },
  },
  {
    name: "a host that stopped",
    probe: { pid: null, alive: false, registration: "enabled", link: away("stopping") },
    tray: { status: "stopped", issues: [] },
    settings: { kind: "offline" },
  },
  {
    name: "a running host the app lost",
    probe: { ...ALIVE, link: away("lost") },
    tray: { status: "issues", issues: ["unreachable"] },
    settings: { kind: "offline" },
  },
  {
    name: "a host too old for this app",
    probe: { ...ALIVE, link: refused("update-host") },
    tray: { status: "issues", issues: ["update-host"] },
    settings: { kind: "offline" },
  },
  {
    name: "a host too new for this app",
    probe: { ...ALIVE, link: refused("update-client") },
    tray: { status: "issues", issues: ["update-app"] },
    settings: { kind: "offline" },
  },
  {
    name: "a host still answering its first dial",
    probe: { ...ALIVE, link: { kind: "connecting" } },
    tray: { status: "running", issues: [] },
    settings: { kind: "offline" },
  },
  {
    name: "a stopped host waiting for approval",
    probe: { pid: null, alive: false, registration: "requires-approval", link: away("lost") },
    tray: { status: "stopped", issues: ["approval"] },
    settings: { kind: "offline" },
  },
  {
    name: "a running host waiting for approval",
    probe: { ...ALIVE, registration: "requires-approval", link: open({ kind: "current" }) },
    tray: { status: "issues", issues: ["approval"] },
    settings: { kind: "current", version: "0.0.29", startedAt: 5 },
  },
];

test("the tray and Settings read the host from its link, its process and its registration", () => {
  expect(
    rows.map((row) => ({
      name: row.name,
      tray: readHostStatus(row.probe),
      settings: readHostProcess(row.probe.link),
    })),
  ).toEqual(rows.map((row) => ({ name: row.name, tray: row.tray, settings: row.settings })));
});
