import { sessionId, type HeadName } from "@nyte-ai/core";
import { openExecution } from "./runtime.ts";

export async function advanceSession(id: string, head: HeadName) {
  "use step";

  const sdk = await openExecution();
  try {
    return await sdk.advance({ sessionId: sessionId(id), head });
  } finally {
    await sdk.close();
  }
}
