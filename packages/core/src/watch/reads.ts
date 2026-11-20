import type { PartId, RunEnd, RunId, SessionId } from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { FoldState } from "../contract/fold.ts";
import type { PartRecord } from "../contract/records.ts";
import { LOCAL } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import { readSession } from "../store/session.ts";

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
