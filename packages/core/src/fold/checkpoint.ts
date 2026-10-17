import {
  asSeq,
  compile,
  ConfigurationType,
  ContextViewType,
  cyclicWithJson,
  DeliveryType,
  FileChangeType,
  HeadInfoType,
  idSchema,
  MessageSourceType,
  MessageType,
  PartViewType,
  ScheduleType,
  SeqType,
  ToolClassType,
  TurnInfoType,
  UserContentType,
  RunViewType,
  WaitOutcomeType,
  WaitTargetType,
} from "@nyte-ai/schema";
import type {
  Configuration,
  ContextView,
  Delivery,
  FileChange,
  HeadInfo,
  HeadName,
  Message,
  MessageSource,
  PartView,
  PrincipalId,
  RunView,
  Schedule,
  SessionId,
  ToolClass,
  TurnInfo,
  UserContent,
  WaitTarget,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static, TSchema, TUnsafe } from "typebox";
import { INDEX } from "../contract/fold.ts";
import type { FoldHead, FoldState, Index, Path } from "../contract/fold.ts";
import type { Kernel } from "../contract/kernel.ts";
import { STORED_RECORD_TYPES } from "../contract/records.ts";
import type { CommitRecord, PartRecord } from "../contract/records.ts";
import { decodeObject } from "../store/log.ts";
import { STORE_VERSION } from "../store/migrations.ts";
import { dev } from "../util/dev-log.ts";
import { EMPTY_CATALOG } from "./fold.ts";

/** The checkpoint format. Bump it whenever folding the same events can give a different state, so no build restores a fold an older one computed differently. */
const FOLD_CHECKPOINT_VERSION = 1;

/** Past this many events since the last checkpoint, the next settled fold writes one, so a cold fold replays about this many and a run's. */
const REPLAY_EVENTS = 1_024;

/** Past this many logged bytes since the last checkpoint, or the checkpoint's own length when larger, the next settled fold writes one: each write is paid for by as many logged bytes, and replaying the gap never costs much more than reading the checkpoint. */
const REPLAY_BYTES = 1_048_576;

const head = idSchema<"head">();

const message = idSchema<"message">();

const turn = idSchema<"turn">();

const FoldCheckpointType = Type.Object({
  version: Type.Literal(FOLD_CHECKPOINT_VERSION),
  store: Type.Number(),
  build: Type.String(),
  seq: SeqType,
  seen: list(entry(idSchema<"principal">(), list(entry(head, nullable(idSchema<"commit">()))))),
  changes: list(typed<FileChange>()(FileChangeType)),
  partViews: list(typed<PartView>()(PartViewType)),
  heads: list(
    entry(
      head,
      Type.Object({
        info: typed<HeadInfo>()(HeadInfoType),
        revision: nullable(idSchema<"revision">()),
        live: list(idSchema<"part">()),
        pending: list(message),
        configuration: Type.Object({
          selected: nullable(typed<Configuration>()(ConfigurationType)),
          effective: nullable(typed<Configuration>()(ConfigurationType)),
        }),
        context: typed<ContextView>()(ContextViewType),
      }),
    ),
  ),
  paths: list(
    entry(
      head,
      Type.Object({
        messages: list(message),
        committed: Type.Number(),
        at: list(entry(message, Type.Number())),
        turns: list(turn),
        turnAt: list(entry(turn, Type.Number())),
        firstAt: list(Type.Number()),
      }),
    ),
  ),
  commits: list(entry(idSchema<"commit">(), typed<CommitRecord>()(STORED_RECORD_TYPES.commit))),
  siblings: list(entry(nullable(idSchema<"commit">()), list(idSchema<"commit">()))),
  inputs: list(
    entry(
      message,
      Type.Object({
        id: message,
        head,
        at: Type.Number(),
        content: typed<UserContent>()(UserContentType),
        source: typed<MessageSource>()(MessageSourceType),
        delivery: typed<Delivery>()(DeliveryType),
        schedule: typed<Schedule>()(ScheduleType),
        covered: Type.Boolean(),
        configuration: typed<Configuration>()(ConfigurationType),
        replaced: nullable(
          Type.Object({ previous: message, stopped: nullable(idSchema<"run">()) }),
        ),
        landed: nullable(
          Type.Object({ commit: idSchema<"commit">(), run: nullable(idSchema<"run">()) }),
        ),
      }),
    ),
  ),
  parts: list(entry(idSchema<"part">(), typed<PartRecord>()(STORED_RECORD_TYPES.part))),
  runs: list(entry(idSchema<"run">(), Type.Object({ view: typed<RunView>()(RunViewType), turn }))),
  calls: list(
    entry(
      idSchema<"call">(),
      Type.Object({
        part: idSchema<"part">(),
        class: typed<ToolClass>()(ToolClassType),
        waiting: nullable(typed<WaitTarget>()(WaitTargetType)),
        settled: Type.Boolean(),
      }),
    ),
  ),
  turns: list(
    entry(
      turn,
      Type.Object({
        info: typed<TurnInfo>()(TurnInfoType),
        head,
        live: list(idSchema<"call">()),
      }),
    ),
  ),
  messages: list(entry(message, typed<Message>()(MessageType))),
  partStates: list(message),
  byRun: list(entry(idSchema<"run">(), list(idSchema<"part">()))),
  riders: list(message),
  thinking: list(entry(turn, Type.Number())),
});

type FoldCheckpointBody = Static<typeof FoldCheckpointType>;

const validator = compile(
  cyclicWithJson({ Root: FoldCheckpointType, WaitOutcome: WaitOutcomeType }, "Root"),
);

/** One session's fold checkpoints: the fold restored from the store's, and the settled fold written whenever replaying to it from the last checkpoint would pass the replay budget. */
export interface FoldCheckpointing {
  /** The fold the session's checkpoint holds as `principal` sees it, or null to fold the log from its start. */
  restore(principal: PrincipalId): Promise<FoldState | null>;
  /** Offers the fold for a checkpoint on a later tick, written when no head runs, nothing streams and the replay budget is spent; offers made while one is written wait for it and run once. */
  settle(): void;
}

/** Returns the checkpointing of `session`'s fold over the kernel's store, inert where the store keeps no checkpoints. `folded` reads the fold as it stands, its maps changing in place under each event, so a checkpoint encodes it in the same tick it reads it; `streaming` tells whether a part of the session streams. */
export function foldCheckpointing(
  kernel: Pick<Kernel, "store" | "description">,
  session: SessionId,
  folded: () => FoldState,
  streaming: () => boolean,
): FoldCheckpointing {
  const store = kernel.store.checkpoints;
  const build = kernel.description.version;
  let kept = { seq: 0, length: 0 };
  let restored = false;
  let offered = false;
  let writing = false;

  const settled = (): FoldState | null => {
    const state = folded();

    if (!restored || state.seq <= kept.seq || streaming()) return null;

    for (const head of state.heads.values())
      if (head.info.execution.kind !== "idle" || head.live.length > 0) return null;

    return state;
  };

  const write = async (): Promise<void> => {
    if (store === undefined || settled() === null) return;

    if (folded().seq - kept.seq <= REPLAY_EVENTS) {
      const gap = await store.gap(session, asSeq(kept.seq));

      if (gap.bytes <= Math.max(REPLAY_BYTES, kept.length)) return;
    }

    const state = settled();

    if (state === null) return;
    const body = encodeFoldCheckpoint(state, build);

    if (body === null) {
      dev("fold", "checkpoint skipped: paths and maps disagree", { session, seq: state.seq });

      return;
    }

    await store.write(session, { seq: state.seq, body });
    kept = { seq: state.seq, length: body.length };
  };

  const drain = async (): Promise<void> => {
    try {
      while (offered) {
        offered = false;
        await write();
      }
    } catch (error) {
      dev("fold", "checkpoint write failed", { session, error: String(error) });
    } finally {
      offered = false;
      writing = false;
    }
  };

  return {
    async restore(principal) {
      const found = await (async () => {
        const checkpoint = await store?.read(session);

        if (checkpoint === undefined || checkpoint === null) return null;
        const state = decodeFoldCheckpoint(checkpoint.body, build, session, principal);

        return state === null ? null : { state, length: checkpoint.body.length };
      })().catch((error) => {
        dev("fold", "checkpoint read failed", { session, error: String(error) });

        return null;
      });

      kept = { seq: found?.state.seq ?? 0, length: found?.length ?? 0 };
      restored = true;

      return found?.state ?? null;
    },
    settle() {
      if (store === undefined) return;
      offered = true;

      if (writing) return;
      writing = true;
      const timer = setTimeout(() => void drain(), 0);

      if (typeof timer === "object") timer.unref();
    },
  };
}

/**
 * Returns `state` as checkpoint text for a store to keep, or null when its paths do not hold the
 * very messages and turns its maps do, the sharing a restored fold rebuilds from ids, as it gives
 * a part's message its part's state again. The text leaves out the principal and what the fold
 * seeds live on every attach: the activation, the catalog and the background items.
 */
function encodeFoldCheckpoint(state: FoldState, build: string): string | null {
  const index = state[INDEX];

  for (const [name, folded] of index.heads) {
    const path = index.paths.get(name);

    if (path?.messages !== folded.messages || path.turns !== folded.turns) return null;
  }

  for (const path of index.paths.values()) {
    if (path.messages.some((item) => index.messages.get(item.id) !== item)) return null;

    if (path.turns.some((info) => index.turns.get(info.id)?.info !== info)) return null;
  }

  const partStates = new Set(
    Array.from(index.messages.values()).flatMap((item) =>
      item.kind === "part" && index.parts.get(item.part)?.state === item.state ? [item.id] : [],
    ),
  );

  const body: FoldCheckpointBody = {
    version: FOLD_CHECKPOINT_VERSION,
    store: STORE_VERSION,
    build,
    seq: state.seq,
    seen: Array.from(state.seen, ([principal, heads]) => [principal, [...heads]]),
    changes: state.changes,
    partViews: state.partViews,
    heads: Array.from(index.heads, ([name, folded]) => [
      name,
      {
        info: folded.info,
        revision: folded.revision,
        live: folded.live,
        pending: folded.pending,
        configuration: folded.configuration,
        context: folded.context,
      },
    ]),
    paths: Array.from(index.paths, ([name, path]) => [
      name,
      {
        messages: path.messages.map((item) => item.id),
        committed: path.committed,
        at: [...path.at],
        turns: path.turns.map((info) => info.id),
        turnAt: [...path.turnAt],
        firstAt: path.firstAt,
      },
    ]),
    commits: [...index.commits],
    siblings: [...index.siblings],
    inputs: [...index.inputs],
    parts: [...index.parts],
    runs: [...index.runs],
    calls: [...index.calls],
    turns: [...index.turns],
    messages: Array.from(index.messages, ([id, item]) =>
      partStates.has(id) ? [id, { ...item, state: null }] : [id, item],
    ),
    partStates: [...partStates],
    byRun: [...index.byRun],
    riders: [...index.riders],
    thinking: [...index.thinking],
  };

  return JSON.stringify(body);
}

/** Returns the fold a checkpoint holds as `principal` sees it, or null for text this format, store version and `build` did not write: a migration may have rewritten the records and events it folded. */
function decodeFoldCheckpoint(
  text: string,
  build: string,
  session: SessionId,
  principal: PrincipalId,
): FoldState | null {
  const body = decodeObject(text);

  if (!validator.Check(body) || body.store !== STORE_VERSION || body.build !== build) return null;
  const parts = new Map(body.parts);
  const messages = new Map(body.messages);
  const turns = new Map(body.turns);

  for (const id of body.partStates) {
    const item = messages.get(id);

    if (item?.kind !== "part") return null;
    const part = parts.get(item.part);

    if (part === undefined) return null;
    messages.set(id, { ...item, state: part.state });
  }

  const paths = new Map<HeadName, Path>();

  for (const [name, stored] of body.paths) {
    const path: Path = {
      messages: [],
      committed: stored.committed,
      at: new Map(stored.at),
      turns: [],
      turnAt: new Map(stored.turnAt),
      firstAt: [...stored.firstAt],
    };

    for (const id of stored.messages) {
      const found = messages.get(id);

      if (found === undefined) return null;
      path.messages.push(found);
    }

    for (const id of stored.turns) {
      const found = turns.get(id);

      if (found === undefined) return null;
      path.turns.push(found.info);
    }

    paths.set(name, path);
  }

  const heads = new Map<HeadName, FoldHead>();

  for (const [name, stored] of body.heads) {
    const path = paths.get(name);

    if (path === undefined) return null;
    heads.set(name, {
      ...stored,
      messages: path.messages,
      turns: path.turns,
      background: [],
    });
  }

  const index: Index = {
    heads,
    commits: new Map(body.commits),
    siblings: new Map(body.siblings),
    inputs: new Map(body.inputs),
    parts,
    runs: new Map(body.runs),
    calls: new Map(body.calls),
    turns,
    messages,
    byRun: new Map(body.byRun.map(([run, parts]) => [run, [...parts]])),
    riders: new Set(body.riders),
    thinking: new Map(body.thinking),
    paths,
  };

  return {
    [INDEX]: index,
    session,
    principal,
    seen: new Map(body.seen.map(([seer, seen]) => [seer, new Map(seen)])),
    seq: body.seq,
    activation: { kind: "inactive" },
    catalog: EMPTY_CATALOG,
    changes: body.changes,
    heads,
    headInfos: Array.from(heads.values(), (folded) => folded.info),
    commits: index.commits,
    siblings: index.siblings,
    inputs: index.inputs,
    parts: index.parts,
    partViews: body.partViews,
    runs: index.runs,
    calls: index.calls,
    turns,
    messages,
  };
}

function typed<T>() {
  return <S extends TSchema>(schema: [Static<S>] extends [T] ? S : never): TUnsafe<T> =>
    Type.Unsafe<T>(schema);
}

function list<T extends TSchema>(item: T) {
  return Type.Immutable(Type.Array(item));
}

function entry<K extends TSchema, V extends TSchema>(key: K, value: V) {
  return Type.Immutable(Type.Tuple([key, value]));
}

function nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}
