import type { PartId, SessionId } from "@nyte-ai/sdk";
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
