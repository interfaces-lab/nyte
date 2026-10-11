import type { CallId, RunEnd, RunId, SessionId, WaitTarget } from "@nyte-ai/schema";
import { send } from "./admission.ts";
import type { FoldState } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import { ALL_AUTHORITY, LOCAL } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { MAIN, isJsonObject, readCall, readSession, withFold } from "./session-state.ts";

const REPORT_LIMIT = 4096;

const CORE: ConnectionContext = {
  principal: LOCAL,
  authority: ALL_AUTHORITY,
  credential: { kind: "token", token: "" },
  origin: null,
};

/** Delivers a child run's report exactly once: nothing when `woke` (a durable wait parked on that run took its end) or when one of `waitedBy`, the ended run record's list of steps parked on it, is a call still waiting on the run (parked on another instance; `poll` or a later park wakes it there), or else a bounded report attached to the parent's originating head. */
export async function deliverChildReport(
  kernel: Kernel,
  child: SessionId,
  run: RunId,
  end: RunEnd,
  woke: boolean,
  waitedBy: readonly { readonly session: SessionId; readonly call: CallId }[],
): Promise<void> {
  if (woke || (await waitedDurably(kernel, child, run, waitedBy))) return;
  const found = await readSession(kernel, child);
  const parent = found?.record.parent ?? null;

  if (found === null || parent === null) return;
  const target = await readSession(kernel, parent);

  if (target === null) return;
  const origin = found.record.origin?.head ?? MAIN;
  const head = target.record.heads.some((entry) => entry.name === origin) ? origin : MAIN;

  const answer = capped(
    (await withFold(kernel, child, (state) => answerOf(state, run))).trim(),
    REPORT_LIMIT,
  );

  const title = `Child ${child} ${end.kind}:`;

  await send(kernel, {
    session: parent,
    head,
    context: CORE,
    content: answer === "" ? title : `${title}\n\n${answer}`,
    options: { source: { kind: "child", session: child }, delivery: "attach" },
  });
}

function answerOf(state: FoldState, run: RunId): string {
  const messages = state.heads.get(MAIN)?.messages ?? [];
  const turn = state.runs.get(run)?.turn ?? messages.at(-1)?.turn;

  return messages
    .flatMap((message) => {
      if (message.kind !== "part" || message.partKind !== "text" || message.turn !== turn)
        return [];
      const part = state.parts.get(message.part)?.state;

      return isJsonObject(part) && typeof part.markdown === "string" && part.markdown !== ""
        ? [part.markdown]
        : [];
    })
    .join("\n\n");
}

function capped(text: string, limit: number): string {
  const bytes = new TextEncoder().encode(text);

  if (bytes.length <= limit) return text;
  let end = limit;

  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;

  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** Returns whether one of the steps the ended run record lists in `waitedBy` is a call with no result still waiting on that run. */
async function waitedDurably(
  kernel: Kernel,
  child: SessionId,
  run: RunId,
  waitedBy: readonly { readonly session: SessionId; readonly call: CallId }[],
): Promise<boolean> {
  const on = (target: WaitTarget): boolean =>
    target.kind === "run" && target.session === child && target.run === run;

  for (const waiter of waitedBy) {
    const record = (await readCall(kernel, waiter.session, waiter.call))?.record;
    const waiting = record?.result === null ? record.waiting : null;

    if (
      waiting !== null &&
      waiting !== undefined &&
      ("targets" in waiting ? waiting.targets.some(on) : on(waiting))
    )
      return true;
  }

  return false;
}
