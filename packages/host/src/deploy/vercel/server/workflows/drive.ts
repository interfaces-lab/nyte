import { sleep } from "workflow";
import type { AdvanceReport, HeadName, SessionId } from "@nyte-ai/schema";
import { vercelHost } from "../utils/host.ts";
import { stepFrom } from "../utils/step.ts";

/** The workflow (`"use workflow"`) that drives one head until it needs nothing: runs `advanceHead` as a step, then follows `stepFrom(report, Date.now())` — another step, Workflow's durable `sleep(ms)`, or return. */
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

/** The step (`"use step"`) `driveHead` runs, on this instance's `vercelHost()`: opens `host.execution.cover({ kind: "sessions", sessions: [input.session] })`, which covers that session and its descendants (§42ac), loads only that session's parked waits and claims nothing, so the session counts as covered here (§42a), its parked waits are loaded, and the lease `advance` claims for the head is owned by that cover and renewed for the step's duration; the advance releases it when its turn ends on anything but `continue`, and closing the cover releases a lease `continue` kept (§42h, §42y, §42ac); fires the due timers and deadlines (`kernel.waits.tick(Date.now())`) so a timer the drive slept on wakes first; answers one `host.execution.advance(input)`; and closes the cover whatever the advance did. */
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
