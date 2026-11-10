import type { AgentRegistration } from "./host-agent.ts";
import type { HostLinkState } from "./host-link.ts";

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
