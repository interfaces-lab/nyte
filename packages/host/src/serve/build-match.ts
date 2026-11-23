import { API_MIN_REVISION, API_REVISION, compareVersions } from "@nyte-ai/schema";
import type { Authority, BuildMatch, HelloFrame, RefusedFrame } from "@nyte-ai/schema";

export type Supervisor = "launchd" | "nyte";

export interface HostBuild {
  readonly version: string;
  readonly operations: string;
  readonly supervisor: Supervisor | null;
}

export type Refusal = Pick<RefusedFrame, "reason" | "message">;

const SUPERVISED_BY = { launchd: ["app"], nyte: ["tui", "cli"] } as const satisfies Record<
  Supervisor,
  readonly HelloFrame["client"]["kind"][]
>;

export function matchBuild(
  host: HostBuild,
  hello: HelloFrame,
  authority: ReadonlySet<Authority>,
): BuildMatch | Refusal {
  const served = `revisions ${API_MIN_REVISION}-${API_REVISION}`;

  if (hello.api_min_revision > API_REVISION) {
    return {
      reason: "update-host",
      message: `Update the host: it serves ${served} and the client needs ${hello.api_min_revision} or later.`,
    };
  }

  if (hello.api_revision < API_MIN_REVISION) {
    return {
      reason: "update-client",
      message: `Update the client: the host serves ${served} and the client speaks up to ${hello.api_revision}.`,
    };
  }

  const order = compareVersions(hello.client.version, host.version);

  if (order !== null && order < 0) return { kind: "host-newer" };

  if ((order ?? 0) === 0 && hello.operations === host.operations) return { kind: "current" };

  if (!authority.has("maintenance")) return { kind: "host-older", replace: "none" };

  if (order === null || order === 0) return { kind: "host-older", replace: "manual" };

  return { kind: "host-older", replace: newerReplacement(host.supervisor, hello.client.kind) };
}

function newerReplacement(
  supervisor: Supervisor | null,
  client: HelloFrame["client"]["kind"],
): "when-idle" | "manual" | "none" {
  if (supervisor === null) return "manual";

  if (SUPERVISED_BY[supervisor].some((kind) => kind === client)) return "when-idle";

  return supervisor === "launchd" ? "none" : "manual";
}
