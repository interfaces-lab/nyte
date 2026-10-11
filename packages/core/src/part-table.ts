import { asId } from "@nyte-ai/schema";
import type { Json, PartId, SessionId, WaitOutcome } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { PartDefinition } from "./parts.ts";
import { decodePartRecord } from "./records.ts";
import { partRef } from "./refs.ts";
import { load, readCall } from "./session-state.ts";

/** Returns the first act on a modal part: the action's name and its validated input. */
export interface Answered {
  readonly action: string;
  readonly input: unknown;
}

/** Returns what one kernel holds in memory about its parts, keyed by part ref: the definitions that created them, closed parts, modal answers, `answer()` waiters and the acts in flight. */
export interface PartTable {
  readonly created: Map<string, PartDefinition>;
  readonly closed: Set<string>;
  readonly answered: Map<string, Answered>;
  readonly waiters: Map<string, Set<(answer: Answered | null) => void>>;
  readonly acting: Map<string, Set<AbortController>>;
}

const tables = new WeakMap<Kernel, PartTable>();

/** Returns the kernel's in-memory part table, empty on first use. */
export function tableOf(kernel: Kernel): PartTable {
  const known = tables.get(kernel);

  if (known !== undefined) return known;

  const table: PartTable = {
    created: new Map(),
    closed: new Set(),
    answered: new Map(),
    waiters: new Map(),
    acting: new Map(),
  };

  tables.set(kernel, table);

  return table;
}

/** Records the first answer to a modal part and resolves its waiters with it. */
export function settle(table: PartTable, name: string, answer: Answered): void {
  if (table.answered.has(name)) return;
  table.answered.set(name, answer);

  for (const resolve of table.waiters.get(name) ?? []) resolve(answer);
  table.waiters.delete(name);
}

/** Marks a part closed in memory: its waiters resolve null, its acts in flight resolve closed, and its creating definition and answer are dropped. */
export function release(table: PartTable, name: string): void {
  table.closed.add(name);
  table.created.delete(name);

  for (const resolve of table.waiters.get(name) ?? []) resolve(null);

  for (const controller of table.acting.get(name) ?? []) controller.abort();
  table.waiters.delete(name);
  table.acting.delete(name);
  table.answered.delete(name);
}

/** Records a modal part's answer another instance settled, as this instance's first act would: its `answer()` promises resolve with it (§42z). */
export function answeredElsewhere(
  kernel: Kernel,
  session: SessionId,
  part: PartId,
  answer: { readonly action: string; readonly input: Json },
): void {
  settle(tableOf(kernel), partRef(session, part), answer);
}

/** Returns the part answers among recorded outcomes, those inside an `all` included. */
export function partAnswers(outcomes: readonly (WaitOutcome | null)[]): readonly {
  readonly part: PartId;
  readonly answer: { readonly action: string; readonly input: Json };
}[] {
  return outcomes.flatMap((outcome) =>
    outcome === null
      ? []
      : outcome.kind === "all"
        ? partAnswers(outcome.outcomes)
        : outcome.kind === "part" && outcome.answer !== null
          ? [{ part: outcome.part, answer: outcome.answer }]
          : [],
  );
}

/** Settles the local `answer()` promises of every modal part another instance may have answered or closed (§42ac), parked here or not: for each part with a pending `answer()`, reads its record once, and when its live status names the call `waiting` on it, reads that call's record and settles the answer it shows; a part whose record is gone resolves null, as a local close does. What `pollStore` runs each pass. */
export async function settleAnswersFrom(kernel: Kernel): Promise<void> {
  const table = tableOf(kernel);

  for (const name of Array.from(table.waiters.keys())) {
    const [root, id, kind, part] = name.split("/");

    if (root !== "sessions" || id === undefined || kind !== "parts" || part === undefined) continue;
    const session = asId<"session">(id);
    const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

    if (found === null) {
      release(table, name);

      continue;
    }

    const status = found.record.status;

    if (status.kind !== "live" || status.waiting === undefined) continue;
    const call = (await readCall(kernel, session, status.waiting))?.record;

    if (call === undefined) continue;

    for (const answered of partAnswers([...call.waits, ...call.partial]))
      if (answered.part === found.record.id) settle(table, name, answered.answer);
  }
}
