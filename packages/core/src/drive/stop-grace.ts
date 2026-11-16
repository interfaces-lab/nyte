import { asId } from "@nyte-ai/schema";
import type { HeadName, RunId, SessionId, ToolOutcome } from "@nyte-ai/schema";
import { settlement } from "../agent/tool-runner.ts";
import type { Settled } from "../agent/tool-runner.ts";
import type { Kernel } from "../contract/kernel.ts";
import { tool } from "../contract/parts.ts";
import { decodePartRecord } from "../contract/records.ts";
import { callPhase } from "../engine/call-phase.ts";
import { settleCall } from "../engine/durable.ts";
import { stopRequested } from "../engine/fence.ts";
import { endRun } from "../engine/runs.ts";
import { partRef } from "../store/refs.ts";
import { load, readCalls } from "../store/session.ts";
import { check } from "../util/json-schema.ts";

const STOP_GRACE_MS = 3_000;

export const OVERDUE = Symbol("overdue");

const STOPPED: ToolOutcome = { kind: "stopped" };

const ABANDONED: Settled = {
  outcome: STOPPED,
  files: null,
  thread: null,
  snapshot: null,
  path: null,
  unattributed: false,
};

export async function outlasting<T>(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  signal: AbortSignal,
  work: Promise<T>,
): Promise<T | typeof OVERDUE> {
  const overdue = Promise.withResolvers<typeof OVERDUE>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    timer = setTimeout(() => overdue.resolve(OVERDUE), STOP_GRACE_MS);
  };

  if (signal.aborted) arm();
  else signal.addEventListener("abort", arm, { once: true });

  try {
    if ((await Promise.race([work, overdue.promise])) !== OVERDUE) return await work;

    return (await stopRequested(kernel.store, session, run)) ? OVERDUE : await work;
  } finally {
    signal.removeEventListener("abort", arm);
    clearTimeout(timer);
  }
}

export async function endOverdue(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
): Promise<null> {
  await abandonCalls(kernel, session, head, run);
  await endRun(kernel, session, run, { kind: "stopped" });

  return null;
}

async function abandonCalls(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
): Promise<void> {
  const open = (await readCalls(kernel.store, session, (id) => id.startsWith(`${run}:`))).filter(
    (record) =>
      record.run === run && record.kind === "tool" && callPhase(record).kind !== "settled",
  );

  for (const record of open) {
    const found = await load(
      kernel.store,
      await kernel.store.refs.get(partRef(session, asId<"part">(record.id))),
      decodePartRecord,
    );

    const checked = found === null ? null : await check(tool.state, found.record.state);

    await settleCall(kernel, { session, call: record.id, run }, async () => ({
      result: STOPPED,
      updates:
        checked === null || checked.kind === "invalid"
          ? []
          : await settlement(
              kernel,
              { session, head, run, call: record.id, name: checked.value.name },
              checked.value,
              ABANDONED,
              null,
            ),
    }));
  }
}
