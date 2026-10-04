import { sessionId, type HeadName } from "@nyte-ai/core";
import { advanceNyte } from "@nyte-ai/vercel";
import { openExecution } from "./runtime.ts";

export async function advanceSession(id: string, head: HeadName) {
  "use step";

  return advanceNyte({ input: { sessionId: sessionId(id), head }, openExecution });
}
