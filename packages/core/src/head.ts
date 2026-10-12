import type {
  CommitId,
  ConfigurationPatch,
  ConfigureOutcome,
  CreateHeadOutcome,
  HeadInfo,
  HeadName,
  MergeOutcome,
  Message,
  MessageId,
  MoveOptions,
  MoveOutcome,
  Position,
  RefUpdate,
  RemoveHeadOutcome,
  Revision,
  RunId,
  SendOptions,
  SessionId,
  SessionView,
  TreeNode,
  TreeView,
  UserContent,
  ViewOptions,
} from "@nyte-ai/schema";
import { send } from "./admission.ts";
import { contributionsOf } from "./models.ts";
import { SdkError } from "./error.ts";
import type { FoldState } from "./fold.ts";
import { historyHead } from "./history.ts";
import type { Kernel } from "./kernel.ts";
import { move } from "./move.ts";
import type { ConnectionContext } from "./principals.ts";
import type { Receipt, SendReceipt } from "./receipt.ts";
import type { CommitRecord, PartRecord, SessionRecord } from "./records.ts";
import { headRef, sessionRef } from "./refs.ts";
import {
  EMPTY_REVISION,
  MAIN,
  STALE,
  START,
  attempt,
  commit,
  expectOf,
  isJsonObject,
  liveRun,
  objectOf,
  pathOf,
  positionOf,
  put,
  readCommit,
  readTip,
  requireSession,
  sameRevision,
  sessionEvent,
  textOf,
  tipOf,
  withFold,
} from "./session-state.ts";
import { viewHead, watchHead } from "./watch.ts";

const PREVIEW = 80;

export interface Head {
  readonly sessionId: SessionId;
  readonly name: HeadName;
  send(content: UserContent, options?: SendOptions): Promise<SendReceipt>;
  configure(patch: ConfigurationPatch): Promise<ConfigureOutcome>;
  view(options?: ViewOptions): Promise<SessionView>;
  watch(options?: ViewOptions): AsyncIterable<SessionView>;
  history(input: {
    readonly before: MessageId;
    readonly limit: number;
  }): Promise<readonly Message[]>;
  tree(): Promise<TreeView>;
  move(position: Position, options?: MoveOptions): Promise<Receipt<MoveOutcome>>;
  compact(input?: {
    readonly instructions?: string;
  }): Promise<
    | { readonly kind: "started"; readonly message: MessageId }
    | { readonly kind: "busy"; readonly run: RunId }
    | { readonly kind: "nothing-to-compact" }
  >;
}

/** Returns one commit with its id, as a tree row is built from it. */
interface Commit {
  readonly id: CommitId;
  readonly record: CommitRecord;
}

/** Returns a handle on one head of a session for a connection, its `send` admitting through `admit`: `send`, or `sendNow` for the api an activation constructs (§44b). Binds synchronously; no I/O. */
export function headHandle(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  head: HeadName,
  admit: typeof send = send,
): Head {
  const { principal } = context;

  return {
    sessionId: session,
    name: head,
    send: (content, options) => admit(kernel, { session, head, context, content, options }),
    configure: (patch) => configure(kernel, session, head, patch),
    view: (options) => viewHead(kernel, { session, head, principal, options }),
    watch: (options) => watchHead(kernel, { session, head, principal, options }),
    history: (input) =>
      historyHead(kernel, { session, head, principal, before: input.before, limit: input.limit }),
    tree: () => tree(kernel, session, head),
    move: (position, options) => move(kernel, session, head, position, options),
    async compact(input) {
      const run = await liveRun(kernel, session, head);

      if (run !== null) return { kind: "busy", run: run.record.view.id };

      return kernel.compact({ session, head, instructions: input?.instructions ?? null });
    },
  };
}

/** Creates a head at a position, default main's tip, and publishes `head created` with the updated session record. */
export async function createHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  input?: { readonly from?: Position },
): Promise<CreateHeadOutcome> {
  return attempt<CreateHeadOutcome>(`Creating head ${head}`, async () => {
    const found = await requireSession(kernel, session);

    if (found.record.heads.some((entry) => entry.name === head)) return { kind: "exists" };
    const main = await readTip(kernel, session, MAIN);
    const from = input?.from ?? positionOf(main.id);
    const source = tipOf(from);

    if (source !== null && (await readCommit(kernel, source)) === null)
      return { kind: "missing-source" };
    const at = Date.now();

    const record: SessionRecord = {
      ...found.record,
      heads: [
        ...found.record.heads,
        {
          name: head,
          stack: { parent: MAIN, base: from, stale: false },
          selected: null,
          lastRun: null,
        },
      ],
    };

    const rows = new Map<HeadName, Partial<HeadInfo>>([[head, { tip: from }]]);

    const created: readonly RefUpdate[] =
      source === null
        ? []
        : [
            {
              name: headRef(session, head),
              target: objectOf(source),
              expect: "absent",
              event: { head, kind: "head", from: null, to: source, reason: "created" },
            },
          ];

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record, at),
        expect: found.ref.revision,
        event: await sessionEvent(kernel, record, rows),
      },
      ...created,
    ]);

    return outcome.kind === "set" ? { kind: "created", basedOn: from } : STALE;
  });
}

/** Fast-forwards a head's stack parent to its tip and publishes `head merged` with the updated session record. */
export async function mergeHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  options?: { readonly expect?: Revision },
): Promise<MergeOutcome> {
  const found = await requireSession(kernel, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  const stack = entry.stack;

  if (head === MAIN || stack === null) return { kind: "is-main" };

  const [own, parent] = await Promise.all([
    readTip(kernel, session, head),
    readTip(kernel, session, stack.parent),
  ]);

  if (options?.expect !== undefined && !sameRevision(options.expect, own.ref))
    return { kind: "stale", revision: own.ref?.revision ?? EMPTY_REVISION };

  if (parent.id !== tipOf(stack.base)) return { kind: "diverged", base: stack.base };
  const tip = positionOf(own.id);

  const record: SessionRecord = {
    ...found.record,
    heads: found.record.heads.map((current) =>
      current.name === head
        ? { ...current, stack: { ...stack, base: tip, stale: false } }
        : current,
    ),
  };

  const outcome = await commit(kernel, [
    {
      name: headRef(session, stack.parent),
      target: own.ref?.target ?? null,
      expect: expectOf(parent.ref),
      event: {
        head: stack.parent,
        kind: "head",
        from: parent.id,
        to: own.id,
        reason: "merged",
      },
    },
    {
      name: sessionRef(session),
      target: await put(kernel, "session", record),
      expect: found.ref.revision,
      event: await sessionEvent(kernel, record),
    },
  ]);

  if (outcome.kind === "stale")
    return {
      kind: "stale",
      revision: (await readTip(kernel, session, head)).ref?.revision ?? EMPTY_REVISION,
    };

  return { kind: "merged", revision: own.ref === null ? EMPTY_REVISION : outcome.revisions[0] };
}

/** Deletes a head's ref and publishes `head removed` with the updated session record; its commits stay reachable from the others. */
export async function removeHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  options?: { readonly expect?: Revision },
): Promise<RemoveHeadOutcome> {
  if (head === MAIN) return { kind: "is-main" };

  return attempt<RemoveHeadOutcome>(`Removing head ${head}`, async () => {
    const found = await requireSession(kernel, session);

    if (!found.record.heads.some((entry) => entry.name === head)) return { kind: "missing" };
    const run = await liveRun(kernel, session, head);

    if (run !== null) return { kind: "busy", run: run.record.view.id };
    const tip = await readTip(kernel, session, head);

    if (options?.expect !== undefined && !sameRevision(options.expect, tip.ref))
      throw new SdkError("stale", `Head ${head} moved since ${options.expect}.`);

    const record: SessionRecord = {
      ...found.record,
      heads: found.record.heads.filter((entry) => entry.name !== head),
    };

    const removed: readonly RefUpdate[] =
      tip.ref === null
        ? []
        : [
            {
              name: headRef(session, head),
              target: null,
              expect: tip.ref.revision,
              event: { head, kind: "head", from: tip.id, to: null, reason: "removed" },
            },
          ];

    const outcome = await commit(kernel, [
      ...removed,
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record),
        expect: found.ref.revision,
        event: await sessionEvent(kernel, record),
      },
    ]);

    return outcome.kind === "set" ? { kind: "removed" } : STALE;
  });
}

/** Returns the session's commit DAG as rows for a head: every commit on every branch, parents first, siblings in creation order, the head's path active; tip and revision from the one folded head. */
export async function tree(kernel: Kernel, session: SessionId, head: HeadName): Promise<TreeView> {
  return withFold(kernel, session, (state) => rows(state, head));
}

async function configure(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  patch: ConfigurationPatch,
): Promise<ConfigureOutcome> {
  const found = await requireSession(kernel, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  const runtime = kernel.pluginsFor(session);
  await runtime.ready;

  const selected = await kernel.resolveConfiguration({
    session,
    head,
    selected: entry.selected,
    patch,
    contributions: contributionsOf(runtime),
  });

  if (selected.kind !== "exact") return selected;

  await attempt(`Configuring ${head}`, async () => {
    const current = await requireSession(kernel, session);

    const record = {
      ...current.record,
      heads: current.record.heads.map((other) =>
        other.name === head ? { ...other, selected } : other,
      ),
    };

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record),
        expect: current.ref.revision,
        event: { head, kind: "configured", selected, effective: selected },
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });

  const ref = await kernel.store.refs.get(headRef(session, head));

  return { kind: "configured", selected, revision: ref?.revision ?? EMPTY_REVISION };
}

function rows(state: FoldState, head: HeadName): TreeView {
  const tips = new Map<CommitId, HeadName[]>();

  for (const [name, folded] of state.heads) {
    const tip = tipOf(folded.info.tip);

    if (tip !== null) tips.set(tip, [...(tips.get(tip) ?? []), name]);
  }

  const children = new Map<CommitId | null, Commit[]>();

  for (const [id, record] of state.commits) {
    const parent =
      record.parent !== null && state.commits.has(record.parent) ? record.parent : null;

    const siblings = children.get(parent) ?? [];
    siblings.push({ id, record });
    children.set(parent, siblings);
  }

  for (const siblings of children.values())
    siblings.sort((left, right) => left.record.at - right.record.at);

  const folded = state.heads.get(head);
  const tip = folded?.info.tip ?? START;
  const active = new Set(pathOf(state.commits, tipOf(tip)));
  const nodes: TreeNode[] = [];

  const pending: { readonly commit: Commit; readonly depth: number; readonly branch: boolean }[] =
    [];

  const enqueue = (siblings: readonly Commit[], depth: number): void => {
    for (let index = siblings.length - 1; index >= 0; index -= 1)
      pending.push({ commit: siblings[index], depth, branch: siblings.length > 1 && index === 0 });
  };

  enqueue(children.get(null) ?? [], 0);

  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const { id, record } = entry.commit;
    const body = record.body;
    const part = body.kind === "user" ? undefined : state.parts.get(body.part);

    nodes.push({
      id,
      parent: record.parent,
      depth: entry.depth,
      branch: entry.branch,
      active: active.has(id),
      heads: tips.get(id) ?? [],
      kind: body.kind,
      partKind: body.kind === "part" ? (part?.partKind ?? null) : null,
      preview:
        body.kind === "user"
          ? textOf(body.content).replace(/\s+/g, " ").trim().slice(0, PREVIEW)
          : partPreview(part),
      at: record.at,
      run: record.run,
    });
    enqueue(children.get(id) ?? [], entry.depth + 1);
  }

  return { revision: folded?.revision ?? EMPTY_REVISION, tip, nodes };
}

function partPreview(part: PartRecord | undefined): string {
  if (part === undefined) return "";
  const state = part.state;

  const text = !isJsonObject(state)
    ? null
    : typeof state.markdown === "string"
      ? state.markdown
      : typeof state.summary === "string"
        ? state.summary
        : typeof state.name === "string"
          ? state.name
          : null;

  const line = (text ?? part.partKind).split("\n").find((current) => current.trim() !== "") ?? "";

  return line.trim().slice(0, PREVIEW);
}
