import type { Nyte } from "@nyte-ai/core";
import { start } from "workflow/api";
import { runSession } from "../workflows/session.ts";
import { openExecution } from "./runtime.ts";

export async function wakeSession(
  input: Pick<Parameters<Nyte["advance"]>[0], "sessionId" | "head">,
): Promise<void> {
  // Only identifiers enter the workflow journal. The fenced core reads current state in each step.
  if (input.head !== undefined) {
    await start(runSession, [input.sessionId, input.head]);

    return;
  }

  const sdk = await openExecution();

  try {
    const heads = await sdk.heads.list({ sessionId: input.sessionId });
    await Promise.all(heads.map(({ head }) => start(runSession, [input.sessionId, head])));
  } finally {
    await sdk.close();
  }
}
