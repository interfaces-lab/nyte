import type { Nyte, HeadName } from "@nyte-ai/core";
import type { start } from "workflow/api";
import type { WakeTarget } from "./outbox.ts";

export { withDispatch } from "./admission.ts";

export type { WakeTarget } from "./outbox.ts";

export async function advanceNyte({
  input,
  openExecution,
}: {
  input: Parameters<Nyte["advance"]>[0];
  openExecution: () => Promise<Pick<Nyte, "advance" | "close">>;
}) {
  const sdk = await openExecution();

  try {
    return await sdk.advance(input);
  } finally {
    await sdk.close();
  }
}

export function createVercelDispatcher({
  workflow,
  openExecution,
  startWorkflow,
}: {
  workflow: (id: string, head: HeadName) => Promise<void>;
  startWorkflow: typeof start;
  openExecution: () => Promise<Pick<Nyte, "heads" | "close">>;
}): (input: WakeTarget) => Promise<void> {
  return async (input) => {
    if (input.head !== undefined) {
      await startWorkflow(workflow, [input.sessionId, input.head]);

      return;
    }

    const sdk = await openExecution();

    try {
      const heads = await sdk.heads.list({ sessionId: input.sessionId });

      for (const { head } of heads) await startWorkflow(workflow, [input.sessionId, head]);
    } finally {
      await sdk.close();
    }
  };
}
