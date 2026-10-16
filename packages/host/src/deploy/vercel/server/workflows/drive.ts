import { sleep } from "workflow";
import type { AdvanceReport, HeadName, SessionId } from "@nyte-ai/schema";
import { vercelHost } from "../utils/host.ts";
import { stepFrom } from "../utils/step.ts";

export async function driveHead(input: {
  readonly session: SessionId;
  readonly head: HeadName;
}): Promise<void> {
  "use workflow";

  for (;;) {
    const next = stepFrom(await advanceHead(input), Date.now());

    if (next.kind === "stop") return;

    if (next.kind === "sleep") await sleep(next.ms);
  }
}

export async function advanceHead(input: {
  readonly session: SessionId;
  readonly head: HeadName;
}): Promise<AdvanceReport> {
  "use step";

  const { host } = await vercelHost();
  const coverage = await host.execution.cover({ kind: "sessions", sessions: [input.session] });

  try {
    await host.kernel.waits.tick(Date.now());

    return await host.execution.advance(input);
  } finally {
    await coverage.close();
  }
}
