import { showsTool } from "@nyte-ai/plugin/client/presentation";
import type { PartId, SessionId, SessionView } from "@nyte-ai/sdk";
import { connection } from "../sdk.tsx";

export async function moveToBackground(sessionId: SessionId, part: PartId): Promise<void> {
  const outcome = await connection().session(sessionId).part(part).act("background", {});

  switch (outcome.kind) {
    case "ok":
    case "closed":
      return;
    case "rejected":
      throw new Error(outcome.reason);
    case "failed":
      throw new Error(outcome.message);
    case "no-owner":
    case "unknown-action":
      throw new Error("This host can't move commands to the background.");
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}

export function findForegroundJobs(view: SessionView | undefined): ReadonlyMap<string, PartId> {
  const running = new Map(
    (view?.messages ?? []).flatMap((message) =>
      showsTool(message) && message.state.phase === "running" && message.status.kind === "live"
        ? [[message.state.call, message.part] as const]
        : [],
    ),
  );

  return new Map(
    (view?.background ?? []).flatMap((item) => {
      const part =
        item.kind === "job" && item.state === "working" && item.startedBy !== null
          ? running.get(item.startedBy)
          : undefined;

      return part === undefined ? [] : [[item.id, part] as const];
    }),
  );
}

export function sameForegroundJobs(
  previous: ReadonlyMap<string, PartId>,
  next: ReadonlyMap<string, PartId>,
): boolean {
  return (
    previous.size === next.size && [...previous].every(([job, part]) => next.get(job) === part)
  );
}
