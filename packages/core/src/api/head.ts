import { isJsonObject, SdkError } from "@nyte-ai/schema";
import type {
  CommitId,
  CreateHeadOutcome,
  HeadInfo,
  HeadName,
  MergeOutcome,
  Position,
  RefUpdate,
  RemoveHeadOutcome,
  Revision,
  SessionId,
  TreeNode,
  TreeView,
} from "@nyte-ai/schema";
import type { FoldState } from "../contract/fold.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { CommitRecord, PartRecord, SessionRecord } from "../contract/records.ts";
import type { Head } from "../contract/session.ts";
import { send } from "../engine/admission.ts";
import { move } from "../engine/move.ts";
import { configure } from "../extend/settings.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { historyHead, viewHead, watchHead } from "../fold/view.ts";
import { headRef, sessionRef } from "../store/refs.ts";
import {
  attempt,
  createPosition,
  EMPTY_REVISION,
  liveRun,
  MAIN,
  put,
  readCommit,
  readPositionCommit,
  readRefExpectation,
  readTip,
  requireSession,
  sameRevision,
  sessionEvent,
  STALE,
  START,
  toCommitObjectId,
  walkCommitPath,
} from "../store/session.ts";
import { extractUserText } from "../util/text.ts";

const PREVIEW = 80;

interface Commit {
  readonly id: CommitId;
  readonly record: CommitRecord;
}

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
      const run = await liveRun(kernel.store, session, head);

      if (run !== null) return { kind: "busy", run: run.record.view.id };

      return kernel.compact({ session, head, instructions: input?.instructions ?? null });
    },
  };
}

export async function createHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  input?: { readonly from?: Position },
): Promise<CreateHeadOutcome> {
  return attempt<CreateHeadOutcome>(`Creating head ${head}`, async () => {
    const found = await requireSession(kernel.store, session);

    if (found.record.heads.some((entry) => entry.name === head)) return { kind: "exists" };
    const main = await readTip(kernel.store, session, MAIN);
    const from = input?.from ?? createPosition(main.id);
    const source = readPositionCommit(from);

    if (source !== null && (await readCommit(kernel.store, source)) === null)
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
              target: toCommitObjectId(source),
              expect: "absent",
              events: [{ head, kind: "head", from: null, to: source, reason: "created" }],
            },
          ];

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel.store, "session", record, at),
        expect: found.ref.revision,
        events: [await sessionEvent(kernel, record, rows)],
      },
      ...created,
    ]);

    return outcome.kind === "set" ? { kind: "created", basedOn: from } : STALE;
  });
}

export async function mergeHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  options?: { readonly expect?: Revision },
): Promise<MergeOutcome> {
  const found = await requireSession(kernel.store, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  const stack = entry.stack;

  if (head === MAIN || stack === null) return { kind: "is-main" };

  const [own, parent, running] = await Promise.all([
    readTip(kernel.store, session, head),
    readTip(kernel.store, session, stack.parent),
    liveRun(kernel.store, session, stack.parent),
  ]);

  if (options?.expect !== undefined && !sameRevision(options.expect, own.ref))
    return { kind: "stale", revision: own.ref?.revision ?? EMPTY_REVISION };

  if (running !== null) return { kind: "busy", run: running.record.view.id };

  if (parent.id !== readPositionCommit(stack.base)) return { kind: "diverged", base: stack.base };
  const tip = createPosition(own.id);

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
      expect: readRefExpectation(parent.ref),
      events: [
        {
          head: stack.parent,
          kind: "head",
          from: parent.id,
          to: own.id,
          reason: "merged",
        },
      ],
    },
    {
      name: sessionRef(session),
      target: await put(kernel.store, "session", record),
      expect: found.ref.revision,
      events: [await sessionEvent(kernel, record)],
    },
  ]);

  if (outcome.kind !== "set")
    return {
      kind: "stale",
      revision: (await readTip(kernel.store, session, head)).ref?.revision ?? EMPTY_REVISION,
    };

  return { kind: "merged", revision: own.ref === null ? EMPTY_REVISION : outcome.revisions[0] };
}

export async function removeHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  options?: { readonly expect?: Revision },
): Promise<RemoveHeadOutcome> {
  if (head === MAIN) return { kind: "is-main" };

  return attempt<RemoveHeadOutcome>(`Removing head ${head}`, async () => {
    const found = await requireSession(kernel.store, session);

    if (!found.record.heads.some((entry) => entry.name === head)) return { kind: "missing" };
    const run = await liveRun(kernel.store, session, head);

    if (run !== null) return { kind: "busy", run: run.record.view.id };
    const tip = await readTip(kernel.store, session, head);

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
              events: [{ head, kind: "head", from: tip.id, to: null, reason: "removed" }],
            },
          ];

    const outcome = await commit(kernel, [
      ...removed,
      {
        name: sessionRef(session),
        target: await put(kernel.store, "session", record),
        expect: found.ref.revision,
        events: [await sessionEvent(kernel, record)],
      },
    ]);

    return outcome.kind === "set" ? { kind: "removed" } : STALE;
  });
}

export async function tree(kernel: Kernel, session: SessionId, head: HeadName): Promise<TreeView> {
  return withFold(kernel, session, (state) => rows(state, head));
}

function rows(state: FoldState, head: HeadName): TreeView {
  const tips = new Map<CommitId, HeadName[]>();

  for (const [name, folded] of state.heads) {
    const tip = readPositionCommit(folded.info.tip);

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
  const active = new Set(walkCommitPath(state.commits, readPositionCommit(tip)));
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
          ? extractUserText(body.content).replace(/\s+/g, " ").trim().slice(0, PREVIEW)
          : partPreview(part),
      at: record.at,
      run: record.run,
    });
    enqueue(children.get(id) ?? [], entry.depth + 1);
  }

  return { revision: folded?.revision ?? null, tip, nodes };
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
