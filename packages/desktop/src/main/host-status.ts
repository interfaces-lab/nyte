import { supersedes } from "@nyte-ai/service/outdated-host";
import type { AgentRegistration, ServingHost } from "./host-agent.ts";
import type { HostLinkState } from "../host/host-link.ts";

export type HostStatus = "running" | "issues" | "stopped";

export type HostIssue = "approval" | "unreachable";

export interface HostProbe {
  readonly pid: number | null;
  readonly alive: boolean;
  readonly registration: AgentRegistration;
  readonly link: HostLinkState["kind"];
}

export interface HostReading {
  readonly status: HostStatus;
  readonly issues: readonly HostIssue[];
}

export function readHostStatus(probe: HostProbe): HostReading {
  const approval = probe.registration === "requires-approval";

  if (probe.pid === null || !probe.alive)
    return { status: "stopped", issues: approval ? ["approval"] : [] };

  const issues = (["approval", "unreachable"] as const).filter((issue) =>
    issue === "approval" ? approval : probe.link === "unreachable",
  );

  return { status: issues.length === 0 ? "running" : "issues", issues };
}

export interface HostUpdateProbe {
  readonly link: HostLinkState;
  readonly appVersion: string;
}

export type HostUpdate = "current" | "stale" | "offline";

export function readHostUpdate(probe: HostUpdateProbe): HostUpdate {
  if (probe.link.kind !== "connected") return "offline";

  if (probe.link.compatible && probe.link.version === probe.appVersion) return "current";

  return "stale";
}

export interface HostRetireProbe extends HostUpdateProbe {
  readonly serving: ServingHost | null;
  /** The process this app's own host job runs, standing by on the host lock or serving, or null when it runs none. */
  readonly job: number | null;
}

/**
 * Whether this app asks the serving host to retire once it is idle. Only an app whose version
 * supersedes the host's asks, and only when its own host takes over: launchd starts the job again
 * when the host is that job's, as after an update, or the job stands by on the lock. Builds that
 * share a home therefore never retire each other's host, and an app never retires a host that
 * nothing of its own replaces. A host on the same version with other operations stays: the host
 * build notice restarts it.
 */
export function retiresHost(probe: HostRetireProbe): boolean {
  const serving = probe.serving;

  if (probe.link.kind !== "connected" || serving === null) return false;

  return (
    supersedes(probe.appVersion, probe.link.version) &&
    (serving.own || (probe.job !== null && probe.job !== serving.pid))
  );
}
