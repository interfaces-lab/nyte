import type {
  Blob,
  Change,
  Commit,
  Effect,
  Event,
  Obj,
  Oid,
  RefName,
  Run,
  Stack,
} from "../model.ts";
import { compactionInfoFromObject } from "../compaction.ts";
import { history } from "../graph.ts";
import type { Objects } from "../store.ts";
import {
  CANCELLED_PREFIX,
  DELETED_REF,
  FACT_PREFIX,
  HEAD_PREFIX,
  STACK_PREFIX,
  decodeFactKey,
  parseCompactionRef,
  parseInboxRef,
  type InboxRefParts,
} from "../names.ts";
import { pendingItem, runInfo } from "./snapshot.ts";
import { JOB_PREFIX, parseJobRecord } from "./jobs.ts";
import type { SessionEvent } from "./types.ts";

/** A backward head move walks toward the root looking for `from`; past this it is reported as a bare move. */
const MAX_WALK = 10_000;
const RUN_PREFIX = "refs/runs/";
const EFFECT_PREFIX = "refs/effects/";
const KEY_PREFIX = "refs/keys/";

type ReadObject = Pick<Objects, "get" | "chain">;
type CommitItem = { readonly oid: Oid; readonly commit: Commit };
type ChangeItem = { readonly oid: Oid; readonly change: Change };
type EffectIntent = Extract<Effect, { readonly state: "intent" }>;

function isChange(object: Obj | undefined): object is Change {
  return object !== undefined && "type" in object && object.type === "change";
}

function isEffect(object: Obj | undefined): object is Effect {
  return object?.kind === "effect";
}

function isRun(object: Obj | undefined): object is Run {
  return object?.kind === "run";
}

function isStack(object: Obj | undefined): object is Stack {
  return object?.kind === "stack";
}

function isBlob(object: Obj | undefined): object is Blob {
  return object?.kind === "blob";
}

function suffix(name: RefName, prefix: string): string | undefined {
  if (!name.startsWith(prefix)) return undefined;
  const value = name.slice(prefix.length);
  return value === "" ? undefined : value;
}

function hasEffectParts(name: RefName): boolean {
  const value = suffix(name, EFFECT_PREFIX);
  if (value === undefined) return false;
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1;
}

async function readChange(read: ReadObject, oid: Oid): Promise<Change> {
  const object = await read.get(oid);
  if (!isChange(object)) throw new Error(`Corrupt queue ref at ${oid}`);
  return object;
}

/** The commits `to` adds over `from`, oldest first; undefined when `from` is not behind `to`. */
async function commitsBetween(
  read: ReadObject,
  from: Oid | null,
  to: Oid | null,
): Promise<readonly CommitItem[] | undefined> {
  const newestFirst: CommitItem[] = [];
  let oid = to;
  for await (const entry of history(read, to, { limit: MAX_WALK })) {
    if (oid === from) break;
    newestFirst.push(entry);
    oid = entry.commit.parent;
  }
  if (oid !== from) return undefined;
  newestFirst.reverse();
  return newestFirst;
}

async function changesBetween(
  read: ReadObject,
  from: Oid | null,
  to: Oid | null,
): Promise<readonly ChangeItem[] | undefined> {
  const newestFirst: ChangeItem[] = [];
  const seen = new Set<Oid>();
  let oid = to;

  while (oid !== from && oid !== null) {
    if (seen.has(oid)) throw new Error(`Change graph cycle at ${oid}`);
    seen.add(oid);
    const change = await readChange(read, oid);
    newestFirst.push({ oid, change });
    oid = change.previous;
  }

  if (oid !== from) return undefined;
  newestFirst.reverse();
  return newestFirst;
}

async function effectIntent(read: ReadObject, oid: Oid, effect: Effect): Promise<EffectIntent> {
  switch (effect.state) {
    case "intent":
      return effect;
    case "waiting":
    case "expired":
    case "signal":
    case "result": {
      const intent = await read.get(effect.intent);
      if (!isEffect(intent) || intent.state !== "intent") {
        throw new Error(`Corrupt effect intent at ${effect.intent} from ${oid}`);
      }
      return intent;
    }
    default: {
      const _exhaustive: never = effect;
      return _exhaustive;
    }
  }
}

async function projectHeadRef(
  event: Extract<Event, { readonly kind: "ref" }>,
  head: string,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  const movedBase = {
    seq: event.seq,
    kind: "head_moved",
    head,
    from: event.from,
    to: event.to,
    reason: event.reason,
  } satisfies SessionEvent;
  const moved: SessionEvent =
    event.actor === undefined ? movedBase : { ...movedBase, actor: event.actor };
  const commits = await commitsBetween(read, event.from, event.to);
  if (commits === undefined) return [moved];
  return [
    moved,
    ...commits.map((item): SessionEvent => ({ seq: event.seq, kind: "commit", head, item })),
  ];
}

async function projectQueueRef(
  event: Extract<Event, { readonly kind: "ref" }>,
  parts: InboxRefParts,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  switch (parts.position) {
    case "tip": {
      const changes = await changesBetween(read, event.from, event.to);
      return (changes ?? []).flatMap(({ oid, change }): SessionEvent[] => {
        // A queued choice already counts among the session's selected inputs; the event names it so a client re-reads them.
        if (change.body.kind === "config") {
          return [{ seq: event.seq, kind: "config_queued", head: parts.head, change: oid }];
        }
        const item = pendingItem({ oid, change, delivery: parts.delivery });
        return item === undefined
          ? []
          : [{ seq: event.seq, kind: "queued", head: parts.head, item }];
      });
    }
    case "base": {
      const changes = await changesBetween(read, event.from, event.to);
      return (
        changes?.map((item): SessionEvent => ({
          seq: event.seq,
          kind: "landed",
          head: parts.head,
          change: item.oid,
        })) ?? []
      );
    }
    default: {
      const _exhaustive: never = parts.position;
      return _exhaustive;
    }
  }
}

async function projectEffectRef(
  event: Extract<Event, { readonly kind: "ref" }>,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  if (event.to === null) return [];
  const effect = await read.get(event.to);
  if (!isEffect(effect)) throw new Error(`Corrupt effect ref at ${event.to}`);
  const intent = await effectIntent(read, event.to, effect);
  const base = {
    seq: event.seq,
    kind: "effect",
    runId: intent.runId,
    callId: intent.callId,
    tool: intent.tool,
    args: intent.args,
  } as const;
  if (effect.state !== "waiting") return [{ ...base, state: effect.state }];
  const waiting = { ...base, state: effect.state, waitId: event.to };
  const selected =
    effect.selection === undefined ? waiting : { ...waiting, selection: effect.selection };
  return [effect.until === undefined ? selected : { ...selected, until: effect.until }];
}

async function projectRef(
  event: Extract<Event, { readonly kind: "ref" }>,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  if (event.name.startsWith(JOB_PREFIX) && event.to !== null) {
    const blob = await read.get(event.to);
    if (!isBlob(blob)) throw new Error(`Corrupt job ref at ${event.to}`);
    return [{ seq: event.seq, kind: "job", job: parseJobRecord(blob.value).info }];
  }
  const head = suffix(event.name, HEAD_PREFIX);
  if (head !== undefined && !head.includes("/")) return projectHeadRef(event, head, read);

  const queue = parseInboxRef(event.name);
  if (queue !== undefined) return projectQueueRef(event, queue, read);

  const cancelled = suffix(event.name, CANCELLED_PREFIX);
  if (cancelled !== undefined && event.to !== null) {
    return [{ seq: event.seq, kind: "queue_cancelled", change: cancelled }];
  }

  if (hasEffectParts(event.name)) return projectEffectRef(event, read);

  const runHead = suffix(event.name, RUN_PREFIX);
  if (runHead !== undefined && !runHead.includes("/")) {
    if (event.to === null) return [];
    const run = await read.get(event.to);
    if (!isRun(run)) throw new Error(`Corrupt run ref at ${event.to}`);
    return [{ seq: event.seq, kind: "run", head: runHead, run: runInfo(run) }];
  }

  const compactionHead = parseCompactionRef(event.name);
  if (compactionHead !== undefined) {
    return [
      {
        seq: event.seq,
        kind: "compaction",
        head: compactionHead,
        compaction:
          event.to === null ? null : compactionInfoFromObject(await read.get(event.to), event.name),
      },
    ];
  }

  const stackHead = suffix(event.name, STACK_PREFIX);
  if (stackHead !== undefined && !stackHead.includes("/")) {
    if (event.to === null) return [];
    const stack = await read.get(event.to);
    if (!isStack(stack)) throw new Error(`Corrupt stack ref at ${event.to}`);
    return [
      {
        seq: event.seq,
        kind: "stack",
        head: stackHead,
        parent: stack.parent,
        base: stack.base,
      },
    ];
  }

  const factRefKey = suffix(event.name, FACT_PREFIX);
  if (factRefKey !== undefined) {
    // Plugin storage escapes its keys; clients and plugins see the key they wrote.
    const key = decodeFactKey(factRefKey);
    if (event.to === null) {
      return [{ seq: event.seq, kind: "fact", key, value: undefined }];
    }
    const fact = await read.get(event.to);
    if (!isBlob(fact)) throw new Error(`Corrupt fact ref at ${event.to}`);
    return [{ seq: event.seq, kind: "fact", key, value: fact.value }];
  }

  if (event.name === DELETED_REF) {
    return event.to === null ? [] : [{ seq: event.seq, kind: "deleted" }];
  }
  if (event.name.startsWith(KEY_PREFIX)) return [];
  return [];
}

/** Project one kernel event without consulting anything except the supplied object reader. */
export async function projectEvent(
  event: Event,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  switch (event.kind) {
    case "ref":
      return projectRef(event, read);
    case "delta":
      switch (event.part) {
        case "text":
          return [
            {
              seq: event.seq,
              kind: "text_delta",
              runId: event.runId,
              attempt: event.attempt,
              index: event.index,
              delta: event.delta,
            },
          ];
        case "thinking":
          return [
            {
              seq: event.seq,
              kind: "reasoning_delta",
              runId: event.runId,
              attempt: event.attempt,
              index: event.index,
              delta: event.delta,
            },
          ];
        default: {
          const _exhaustive: never = event.part;
          return _exhaustive;
        }
      }
    case "progress":
      return [
        {
          seq: event.seq,
          kind: "tool_progress",
          runId: event.runId,
          callId: event.callId,
          progress: event.progress,
        },
      ];
    case "notice":
      return [
        {
          seq: event.seq,
          kind: "diagnostic",
          level: event.level,
          owner: event.owner,
          message: event.message,
        },
      ];
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
