import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  HeadName,
  ObjectId,
  PartId,
  RefUpdate,
  RunId,
  SessionId,
  ToolPartState,
  WaitOutcome,
} from "@nyte-ai/schema";
import type { Failure } from "@nyte-ai/schema/model";
import type { SessionBus } from "../contract/fold.ts";
import type { Kernel } from "../contract/kernel.ts";
import { tool } from "../contract/parts.ts";
import type { Answered, PartTable } from "../contract/parts.ts";
import { decodePartRecord } from "../contract/records.ts";
import type { CommitRecord, PartRecord } from "../contract/records.ts";
import { check } from "../util/json-schema.ts";
import { headRef, parseSessionRef, partRef } from "./refs.ts";
import { load, put, readCall, readRefExpectation, toCommitObjectId } from "./session.ts";
import type { Tip } from "./session.ts";
import type { StoreConnection } from "../contract/store.ts";

/** The host's part waiters and actions; a waiter on a part that fails is answered null, from the bus, wherever the failure was written. */
export function createPartTable(bus: SessionBus): PartTable {
  const table: PartTable = { waiters: new Map(), acting: new Map() };

  bus.subscribeAll((session, event) => {
    if (event.kind === "part" && event.change === "failed")
      dismiss(table, partRef(session, event.part));
  });

  return table;
}

export function settle(table: PartTable, name: string, answer: Answered): void {
  for (const resolve of table.waiters.get(name) ?? []) resolve(answer);
  table.waiters.delete(name);
}

export function release(table: PartTable, name: string): void {
  dismiss(table, name);

  for (const controller of table.acting.get(name) ?? []) controller.abort();
  table.acting.delete(name);
}

export function releaseParts(table: PartTable, session: SessionId): void {
  for (const name of new Set([...table.waiters.keys(), ...table.acting.keys()]))
    if (parseSessionRef(name) === session) release(table, name);
}

export function dismiss(table: PartTable, name: string): void {
  for (const resolve of table.waiters.get(name) ?? []) resolve(null);
  table.waiters.delete(name);
}

function partAnswers(outcomes: readonly (WaitOutcome | null)[]): readonly {
  readonly part: PartId;
  readonly answer: Answered;
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

export async function storedAnswer(
  store: StoreConnection,
  session: SessionId,
  record: PartRecord,
): Promise<Answered | null> {
  const status = record.status;

  if (status.kind !== "live") return null;

  if (status.answer !== undefined) return status.answer;

  if (status.waiting === undefined) return null;
  const call = (await readCall(store, session, status.waiting))?.record;
  const outcomes = call === undefined ? [] : [...call.waits, ...call.partial];

  return partAnswers(outcomes).find((entry) => entry.part === record.id)?.answer ?? null;
}

export async function settleAnswersFrom(kernel: Kernel): Promise<void> {
  const table = kernel.partTable;

  for (const name of Array.from(table.waiters.keys())) {
    const session = parseSessionRef(name);
    const found = await load(kernel.store, await kernel.store.refs.get(name), decodePartRecord);

    if (
      session === null ||
      found === null ||
      (found.record.placement.kind === "modal" && found.record.status.kind !== "live")
    ) {
      release(table, name);

      continue;
    }

    const answer = await storedAnswer(kernel.store, session, found.record);

    if (answer !== null) settle(table, name, answer);
  }
}

export async function settling(
  store: StoreConnection,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly parent: CommitId | null;
    readonly expect: RefUpdate["expect"];
    readonly record: PartRecord;
    readonly body: CommitRecord["body"];
    readonly at: number;
  },
): Promise<{
  readonly landed: CommitId;
  readonly target: ObjectId;
  readonly updates: RefUpdate[];
}> {
  const { session, head, run, parent, record, body, at } = input;
  const landed = asId<"commit">(await put(store, "commit", { parent, at, run, body }, at));
  const status = { kind: "settled", commit: landed, endedAt: at } as const;
  const target = await put(store, "part", { ...record, status }, at);
  const part = record.id;

  return {
    landed,
    target,
    updates: [
      {
        name: partRef(session, part),
        target,
        events: [{ head, kind: "part", part, change: "settled", commit: landed, endedAt: at }],
      },
      {
        name: headRef(session, head),
        target: toCommitObjectId(landed),
        expect: input.expect,
        events: [{ head, kind: "commit", id: landed, parent, run, body }],
      },
    ],
  };
}

export async function stoppedParts(
  store: StoreConnection,
  session: SessionId,
  head: HeadName,
  tip: Tip,
  parts: readonly PartId[],
  failure: Failure,
): Promise<readonly RefUpdate[]> {
  const at = Date.now();
  const committed: RefUpdate[] = [];
  const failing: PartId[] = [];
  let parent = tip.id;

  for (const part of new Set(parts)) {
    const name = partRef(session, part);
    const found = await load(store, await store.refs.get(name), decodePartRecord);

    if (found === null || found.record.status.kind !== "live") continue;

    const checked =
      found.record.partKind === tool.kind ? await check(tool.state, found.record.state) : null;

    if (checked?.kind !== "valid" || checked.value.phase === "settled") {
      failing.push(part);
      continue;
    }

    const { call, args } = checked.value;

    const state = {
      call,
      name: checked.value.name,
      args,
      class: checked.value.class,
      phase: "settled",
      outcome: { kind: "stopped" },
      changes: null,
    } satisfies ToolPartState;

    const version = found.record.version + 1;
    const record = { ...found.record, state, version };

    const landed = await settling(store, {
      session,
      head,
      run: found.record.run,
      parent,
      expect: parent === tip.id ? readRefExpectation(tip.ref) : undefined,
      record,
      body: { kind: "part", part },
      at,
    });

    committed.push(
      {
        name,
        target: await put(store, "part", record, at),
        expect: found.ref.revision,
        events: [{ head, kind: "part", part, change: "updated", state, version }],
      },
      ...landed.updates,
    );
    parent = landed.landed;
  }

  return [...committed, ...(await failedParts(store, session, head, failing, failure))];
}

export async function failedParts(
  store: StoreConnection,
  session: SessionId,
  head: HeadName,
  parts: readonly PartId[],
  failure: Failure,
): Promise<readonly RefUpdate[]> {
  const updates = await Promise.all(
    [...new Set(parts)].map(async (part): Promise<readonly RefUpdate[]> => {
      const name = partRef(session, part);
      const found = await load(store, await store.refs.get(name), decodePartRecord);

      if (found === null || found.record.status.kind !== "live") return [];

      return [
        {
          name,
          target: await put(store, "part", {
            ...found.record,
            status: { kind: "failed", run: found.record.run, failure },
          }),
          expect: found.ref.revision,
          events: [{ head, kind: "part", part, change: "failed", failure }],
        },
      ];
    }),
  );

  return updates.flat();
}
