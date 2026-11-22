import type { HeadName, PartId, PrincipalId, RunEnd, RunId, SessionId } from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { FoldState } from "../contract/fold.ts";
import type { PartRecord } from "../contract/records.ts";
import { LOCAL } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import { readReceipt, readSession } from "../store/session.ts";

export async function withFold<T>(
  kernel: Kernel,
  session: SessionId,
  read: (state: FoldState) => T,
): Promise<T> {
  const hold = kernel.folds.acquire(session, LOCAL);

  try {
    await hold.ready();

    return read(hold.state());
  } finally {
    hold.release();
  }
}

export async function findSender(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<PrincipalId | null> {
  const latest = await withFold(kernel, session, (state) =>
    state.heads
      .get(head)
      ?.messages.findLast(
        (message) =>
          message.kind === "user" &&
          message.source.kind === "user" &&
          message.status.kind === "landed",
      ),
  );

  if (latest === undefined) return null;
  const receipt = (await readReceipt(kernel.store, session, latest.id))?.record;

  return receipt?.kind === "send" ? (receipt.principal ?? null) : null;
}

export function liveParts(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<readonly PartId[]> {
  return withFold(kernel, session, (state) =>
    readUnsettledParts(state).flatMap((part) => (part.run === run ? [part.id] : [])),
  );
}

export function readUnsettledParts(state: FoldState): readonly PartRecord[] {
  return [...state[INDEX].unsettled].flatMap((id) => {
    const part = state.parts.get(id);

    return part === undefined ? [] : [part];
  });
}

export async function readRunEnd(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<RunEnd | null> {
  const found = await readSession(kernel.store, session);
  const last = found?.record.heads.find((head) => head.lastRun?.id === run)?.lastRun;

  if (last !== undefined && last !== null) return last.end;

  return withFold(kernel, session, (state) => {
    for (const turn of state.turns.values()) {
      if (turn.info.run === run && turn.info.state.kind === "ended") return turn.info.state.end;
    }

    return null;
  });
}
