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

export function findForegroundJobs(
  view: Pick<SessionView, "messages" | "background"> | undefined,
): ReadonlyMap<string, PartId> {
  const jobs = (view?.background ?? []).flatMap((item) =>
    item.kind === "job" && item.state === "working" && item.startedBy !== null
      ? [[item.id, item.startedBy] as const]
      : [],
  );

  if (jobs.length === 0) return new Map<string, PartId>();
  const running = new Map(
    (view?.messages ?? []).flatMap((message) =>
      message.kind === "part" &&
      message.status.kind === "live" &&
      showsTool(message) &&
      message.state.phase === "running"
        ? [[message.state.call, message.part] as const]
        : [],
    ),
  );

  return new Map(
    jobs.flatMap(([id, startedBy]) => {
      const part = running.get(startedBy);

      return part === undefined ? [] : [[id, part] as const];
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
