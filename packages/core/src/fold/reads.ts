import type { PartId, RunEnd, RunId, SessionId } from "@nyte-ai/schema";
import type { FoldState } from "../contract/fold.ts";
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
    [...state.parts.values()].flatMap((part) =>
      part.run === run && (part.status.kind === "live" || part.status.kind === "waiting")
        ? [part.id]
        : [],
    ),
  );
}

export async function readRunEnd(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<RunEnd | null> {
  const found = await readSession(kernel, session);
  const last = found?.record.heads.find((head) => head.lastRun?.id === run)?.lastRun;

  if (last !== undefined && last !== null) return last.end;

  return withFold(kernel, session, (state) => {
    for (const turn of state.turns.values()) {
      if (turn.info.run === run && turn.info.state.kind === "ended") return turn.info.state.end;
    }

    return null;
  });
}
