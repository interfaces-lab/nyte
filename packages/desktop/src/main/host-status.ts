import type { HostProcess } from "@nyte-ai/app/contract/bridge.ts";
import type { LinkState } from "@nyte-ai/sdk/client";
import type { AgentRegistration } from "./host-agent.ts";

export type HostStatus = "running" | "restarting" | "issues" | "stopped";

export type HostIssue = "approval" | "unreachable" | "update-host" | "update-app";

export interface HostProbe {
  readonly pid: number | null;
  readonly alive: boolean;
  readonly registration: AgentRegistration;
  readonly link: LinkState;
}

export interface HostReading {
  readonly status: HostStatus;
  readonly issues: readonly HostIssue[];
}

export function readHostStatus(probe: HostProbe): HostReading {
  const approval = probe.registration === "requires-approval";
  const { link } = probe;

  if (link.kind === "away" && (link.reason === "replacing" || link.reason === "restarting")) {
    return { status: "restarting", issues: approval ? ["approval"] : [] };
  }

  if (probe.pid === null || !probe.alive) {
    return { status: "stopped", issues: approval ? ["approval"] : [] };
  }

  const issues: readonly HostIssue[] = [
    ...(approval ? (["approval"] as const) : []),
    ...(link.kind === "away" || link.kind === "refused" ? [linkIssue(link)] : []),
  ];

  return { status: issues.length === 0 ? "running" : "issues", issues };
}

function linkIssue(link: Extract<LinkState, { readonly kind: "away" | "refused" }>): HostIssue {
  if (link.kind === "away") return "unreachable";

  if (link.reason === "update-host") return "update-host";

  return link.reason === "update-client" ? "update-app" : "unreachable";
}

export function readHostProcess(link: LinkState): HostProcess {
  switch (link.kind) {
    case "open": {
      const stale = link.match.kind === "host-older" && link.match.replace === "manual";

      return {
        kind: stale ? "stale" : "current",
        version: link.version,
        startedAt: link.startedAt,
      };
    }
    case "away":
      return link.reason === "lost" || link.reason === "stopping"
        ? { kind: "offline" }
        : { kind: "restarting" };
    case "connecting":
    case "refused":
    case "closed":
      return { kind: "offline" };
    default: {
      const _exhaustive: never = link;

      return _exhaustive;
    }
  }
}
