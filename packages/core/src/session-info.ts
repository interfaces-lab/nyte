import { asId } from "@nyte-ai/schema";
import type {
  Execution,
  HeadInfo,
  HeadName,
  Json,
  Position,
  PrincipalId,
  Ref,
  SessionId,
  SessionInfo,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import {
  decodeRunRecord,
  decodeSeenRecord,
  decodeSessionRecord,
} from "./records.ts";
import type { HeadRecord, RunRecord } from "./records.ts";
import { headRef, seenRef, sessionRef } from "./refs.ts";

/** Returns the directory row: parent, workspace, heads, activation; null when the session ref is absent. */
export async function sessionInfo(
  kernel: Kernel,
  id: SessionId,
  principal: PrincipalId,
): Promise<SessionInfo | null> {
  const record = await load(
    kernel,
    await kernel.store.refs.get(sessionRef(id)),
    decodeSessionRecord,
  );

  if (record === null) return null;
  const runs = await liveRuns(kernel, id);

  const heads = await Promise.all(
    record.heads.map((head) => headInfo(kernel, id, principal, head, runs.get(head.name))),
  );

  return {
    id: record.id,
    name: record.name,
    parent: record.parent,
    workspace: record.workspace,
    pinned: record.pinned,
    archived: record.archived,
    activation: kernel.activation(id),
    heads,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
  };
}

async function headInfo(
  kernel: Kernel,
  id: SessionId,
  principal: PrincipalId,
  head: HeadRecord,
  run: RunRecord | undefined,
): Promise<HeadInfo> {
  const { refs } = kernel.store;

  const [ref, seen] = await Promise.all([
    refs.get(headRef(id, head.name)),
    refs.get(seenRef(id, principal, head.name)).then((ref) => load(kernel, ref, decodeSeenRecord)),
  ]);

  const commit = ref === null || ref.target === null ? null : asId<"commit">(ref.target);
  const tip: Position = commit === null ? { kind: "start" } : { kind: "commit", id: commit };

  return {
    name: head.name,
    tip,
    stack: head.stack,
    execution: run === undefined ? { kind: "idle", lastRun: head.lastRun } : execution(run),
    unread: commit !== (seen?.commit ?? null),
  };
}

async function liveRuns(kernel: Kernel, id: SessionId): Promise<ReadonlyMap<HeadName, RunRecord>> {
  const refs = await kernel.store.refs.list(`${sessionRef(id)}/runs/`);
  const runs = await Promise.all(refs.map((ref) => load(kernel, ref, decodeRunRecord)));

  return new Map(runs.flatMap((run) => (run === null ? [] : [[run.view.head, run] as const])));
}

function execution(run: RunRecord): Execution {
  if (run.waiting !== null) return { kind: "waiting", run: run.view, on: run.waiting };

  if (run.retrying !== null)
    return {
      kind: "retrying",
      run: run.view,
      until: run.retrying.until,
      reason: run.retrying.reason,
    };

  return { kind: "live", run: run.view, phase: run.phase, stopping: run.stopping };
}

async function load<T>(
  kernel: Kernel,
  ref: Ref | null,
  decode: (object: Json | null) => T | null,
): Promise<T | null> {
  if (ref === null || ref.target === null) return null;
  const record = decode(await kernel.store.objects.get(ref.target));

  if (record === null)
    throw new SdkError("internal", `${ref.name} does not hold the record its name says`);

  return record;
}
