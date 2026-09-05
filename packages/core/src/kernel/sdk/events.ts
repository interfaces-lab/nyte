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
import {
  CANCELLED_PREFIX,
  DELETED_REF,
  FACT_PREFIX,
  HEAD_PREFIX,
  STACK_PREFIX,
  parseQueueRef,
  type QueueRefParts,
} from "../names.ts";
import { runInfo } from "./snapshot.ts";
import type { PendingItem, SessionEvent } from "./types.ts";

const MAX_WALK = 10_000;
const RUN_PREFIX = "refs/runs/";
const EFFECT_PREFIX = "refs/effects/";
const KEY_PREFIX = "refs/keys/";

type ReadObject = (oid: Oid) => Promise<Obj | undefined>;
type CommitItem = { readonly oid: Oid; readonly commit: Commit };
type ChangeItem = { readonly oid: Oid; readonly change: Change };
type EffectIntent = Extract<Effect, { readonly state: "intent" }>;

function isCommit(object: Obj | undefined): object is Commit {
  return object?.kind === "commit";
}

function isChange(object: Obj | undefined): object is Change {
  return object?.kind === "change";
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

async function readCommit(read: ReadObject, oid: Oid): Promise<Commit> {
  const object = await read(oid);
  if (!isCommit(object)) throw new Error(`Corrupt commit ref at ${oid}`);
  return object;
}

async function readChange(read: ReadObject, oid: Oid): Promise<Change> {
  const object = await read(oid);
  if (!isChange(object)) throw new Error(`Corrupt queue ref at ${oid}`);
  return object;
}

async function commitsBetween(
  read: ReadObject,
  from: Oid | null,
  to: Oid | null,
): Promise<readonly CommitItem[] | undefined> {
  const newestFirst: CommitItem[] = [];
  const seen = new Set<Oid>();
  let oid = to;
  let walked = 0;

  while (oid !== from && oid !== null && walked < MAX_WALK) {
    if (seen.has(oid)) throw new Error(`Commit graph cycle at ${oid}`);
    seen.add(oid);
    const commit = await readCommit(read, oid);
    newestFirst.push({ oid, commit });
    oid = commit.parent;
    walked += 1;
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

function pendingItem(oid: Oid, change: Change, lane: string): PendingItem | undefined {
  const body = change.body;
  switch (body.kind) {
    case "message":
      switch (body.message.role) {
        case "user":
          const pending = {
            change: oid,
            lane,
            at: change.at,
            content: body.message.content,
          };
          return change.author === undefined ? pending : { ...pending, author: change.author };
        case "assistant":
        case "toolResult":
          return undefined;
        default: {
          const _exhaustive: never = body.message;
          return _exhaustive;
        }
      }
    case "checkpoint":
    case "summary":
    case "config":
    case "note":
      return undefined;
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
}

async function effectIntent(read: ReadObject, oid: Oid, effect: Effect): Promise<EffectIntent> {
  switch (effect.state) {
    case "intent":
      return effect;
    case "waiting":
    case "signal":
    case "result": {
      const intent = await read(effect.intent);
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
  parts: QueueRefParts,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  switch (parts.position) {
    case "tip": {
      const changes = await changesBetween(read, event.from, event.to);
      return (changes ?? []).flatMap(({ oid, change }): SessionEvent[] => {
        const item = pendingItem(oid, change, parts.lane);
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
  const effect = await read(event.to);
  if (!isEffect(effect)) throw new Error(`Corrupt effect ref at ${event.to}`);
  const intent = await effectIntent(read, event.to, effect);
  return [
    {
      seq: event.seq,
      kind: "effect",
      runId: intent.runId,
      callId: intent.callId,
      state: effect.state,
      tool: intent.tool,
      args: intent.args,
    },
  ];
}

async function projectRef(
  event: Extract<Event, { readonly kind: "ref" }>,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  const head = suffix(event.name, HEAD_PREFIX);
  if (head !== undefined && !head.includes("/")) return projectHeadRef(event, head, read);

  const queue = parseQueueRef(event.name);
  if (queue !== undefined) return projectQueueRef(event, queue, read);

  const cancelled = suffix(event.name, CANCELLED_PREFIX);
  if (cancelled !== undefined && event.to !== null) {
    return [{ seq: event.seq, kind: "queue_cancelled", change: cancelled }];
  }

  if (hasEffectParts(event.name)) return projectEffectRef(event, read);

  const runHead = suffix(event.name, RUN_PREFIX);
  if (runHead !== undefined && !runHead.includes("/")) {
    if (event.to === null) return [];
    const run = await read(event.to);
    if (!isRun(run)) throw new Error(`Corrupt run ref at ${event.to}`);
    return [{ seq: event.seq, kind: "run", head: runHead, run: runInfo(run) }];
  }

  const stackHead = suffix(event.name, STACK_PREFIX);
  if (stackHead !== undefined && !stackHead.includes("/")) {
    if (event.to === null) return [];
    const stack = await read(event.to);
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

  const factKey = suffix(event.name, FACT_PREFIX);
  if (factKey !== undefined) {
    if (event.to === null) {
      return [{ seq: event.seq, kind: "fact", key: factKey, value: undefined }];
    }
    const fact = await read(event.to);
    if (!isBlob(fact)) throw new Error(`Corrupt fact ref at ${event.to}`);
    return [{ seq: event.seq, kind: "fact", key: factKey, value: fact.value }];
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
