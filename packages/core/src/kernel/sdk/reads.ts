/**
 * Read-only projections a client draws from a pooled session: the session
 * page, the snapshot a watch starts from, context status, and a run's diff.
 * Nothing here instantiates plugins; `runs.revert` moves files, never a ref.
 */
import { providerIdentity } from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/schema";
import { CursorExpired, isTerminalPhase, schemas } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type {
  FileDiff,
  OperationInput,
  OperationOutput,
  RunDiff,
  TreeId,
  TreeOutcome,
} from "@nyte-ai/protocol";
import { activeCompaction } from "../compaction.ts";
import { branch } from "../graph.ts";
import type { Commit, Oid, Seq } from "../model.ts";
import { WORKSPACE_REF, factRef, headRef } from "../names.ts";
import { pending } from "../queue.ts";
import type { Session } from "../store.ts";
import { projectContextStatus, projectUsage, transcriptFromCommits } from "@nyte-ai/client";
import { policyKey } from "../../plugins/model-context.ts";
import {
  CWD_FACT,
  clientActivation,
  workspaceRef,
  type Pooled,
  type SessionPool,
} from "./session-pool.ts";
import {
  PARENT_FACT,
  ROW_FACTS,
  factFields,
  headConfig,
  pendingItems,
  sessionInfo,
  withFacts,
  withLease,
} from "./snapshot.ts";
import {
  CorruptObject,
  MAIN,
  UnknownSession,
  sessionId,
  type HeadName,
  type NyteOptions,
  type ParkedCall,
  type RunInfo,
  type RunRevertOutcome,
  type SessionId,
  type SessionInfo,
} from "./types.ts";

/** Sessions examined at once by `sessions.list`; bounds open handles and store reads per page. */
const LIST_BATCH = 8;

/** Bumped when the stored row's shape changes; a row in another format is rebuilt. */
const LISTING_FORMAT = 1;

const checkListing = Compile(
  Type.Object({ format: Type.Literal(LISTING_FORMAT), row: schemas.SessionInfo }),
);

function encodeListing(row: SessionInfo): string {
  return JSON.stringify({ format: LISTING_FORMAT, row });
}

function decodeListing(body: string): SessionInfo | undefined {
  let value: unknown;

  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }

  return checkListing.Check(value) ? value.row : undefined;
}

type RowChange = "none" | "facts" | "rebuild";

/** A built row still answering for its session, and whether its facts must be read again. */
interface Reusable {
  readonly change: Exclude<RowChange, "rebuild">;
  readonly info: SessionInfo;
}

const FACTS = factRef("");

/** Row facts read again in place; a new parent moves the tree, so it rebuilds. */
const REFRESHED_FACTS: ReadonlySet<string> = new Set(
  ROW_FACTS.filter((key) => key !== PARENT_FACT).map(factRef),
);

/** Facts that decide the row without being row facts, or that move the tree. */
const REBUILT_FACTS: ReadonlySet<string> = new Set([factRef(PARENT_FACT), factRef(CWD_FACT)]);

/**
 * What the stream after `builtAt`, up to `seq`, did to a row built at
 * `builtAt`. Every ref a store update moves appends its own event, so each is
 * classified: a row fact is read again, a fact the row never reads leaves it,
 * and anything else (a parent, a legacy `cwd`, history, queue, runs, effects,
 * and every family added later) rebuilds it. A stream the store trimmed, or
 * one too far past the row, rebuilds it too.
 */
async function rowChange(session: Session, builtAt: Seq, seq: Seq): Promise<RowChange> {
  if (builtAt === seq) return "none";

  if (seq - builtAt > 256) return "rebuild";

  const events = await session.events
    .read({ afterSeq: builtAt, limit: 256 })
    .catch((cause: unknown) => {
      if (cause instanceof CursorExpired) return undefined;
      throw cause;
    });

  if (events === undefined) return "rebuild";
  let change: RowChange = "none";

  for (const event of events) {
    if (event.seq > seq) break;

    if (event.kind !== "ref") continue;

    if (REFRESHED_FACTS.has(event.name)) change = "facts";
    else if (!event.name.startsWith(FACTS) || REBUILT_FACTS.has(event.name)) return "rebuild";
  }

  return change;
}

interface RowFilter {
  readonly parent?: SessionId | null;
  readonly includeArchived?: boolean;
}

/** One test for a row and for the facts it is built from, so a filter before the build agrees with one after. */
function admits(filter: RowFilter, row: Pick<SessionInfo, "archived" | "parent">): boolean {
  if (row.archived && filter.includeArchived !== true) return false;

  if (filter.parent === null) return row.parent === undefined;

  return filter.parent === undefined || row.parent?.sessionId === filter.parent;
}

function matches(info: SessionInfo, needle: string): boolean {
  return (
    (info.name ?? "").toLowerCase().includes(needle) ||
    (info.preview ?? "").toLowerCase().includes(needle)
  );
}

function orderParkedCalls(
  calls: readonly ParkedCall[],
  commits: readonly { readonly commit: Commit }[],
): ParkedCall[] {
  const callIds: string[] = [];

  for (let index = commits.length - 1; index >= 0; index--) {
    const body = commits[index]?.commit.body;

    if (
      body?.kind !== "message" ||
      body.message.role !== "assistant" ||
      !Array.isArray(body.message.content)
    ) {
      continue;
    }

    for (const part of body.message.content) {
      if (part.type === "toolCall") callIds.push(part.id);
    }

    if (callIds.length > 0) break;
  }

  const positions = new Map(callIds.map((callId, index) => [callId, index]));

  return calls.toSorted((left, right) => {
    const leftPosition = positions.get(left.callId);
    const rightPosition = positions.get(right.callId);

    if (leftPosition === undefined) return rightPosition === undefined ? 0 : 1;

    if (rightPosition === undefined) return -1;

    return leftPosition - rightPosition;
  });
}

export function createReads(input: {
  readonly options: NyteOptions;
  readonly pool: SessionPool;
  readonly resolveModel: (ref: {
    readonly provider?: string;
    readonly id: string;
  }) => Model<Api> | undefined;
}) {
  const { options, pool, resolveModel } = input;

  const projectContext = (pooled: Pooled, commits: readonly Commit[], run: RunInfo | undefined) => {
    const config = headConfig(commits, run);
    const model = config.model === undefined ? undefined : resolveModel(config.model);

    // Context reads must not instantiate plugins on an observing host.
    const policy =
      model === undefined
        ? undefined
        : pooled.activation?.registries.modelContext.get(policyKey(model));

    const checkpoint = commits.findLastIndex((commit) => commit.body.kind === "checkpoint");

    return {
      config,
      status: projectContextStatus(
        checkpoint < 0 ? commits : commits.slice(checkpoint),
        policy?.contextWindow ?? model?.contextWindow ?? 0,
        model === undefined ? undefined : providerIdentity(model),
      ),
      usage: projectUsage(commits).total,
    };
  };

  /**
   * The row the store kept from an earlier list, and what the stream did to
   * it since. The host's answer is never stored, so it is asked for again; a
   * child's workspace is its root's, whose move leaves this stream untouched,
   * so the stored workspace is checked against the one the tree acts in now.
   */
  const storedListing = async (
    pooled: Pooled,
    id: SessionId,
    seq: Seq,
  ): Promise<Reusable | undefined> => {
    const stored = await pooled.session.listing.read();

    if (stored === undefined) return undefined;
    const row = decodeListing(stored.body);

    if (row === undefined) return undefined;
    const change = await rowChange(pooled.session, stored.seq, seq);

    if (change === "rebuild") return undefined;

    const [workspace, activation] = await Promise.all([
      pool.storedWorkspace(pooled),
      pool.resolveSessionActivation(id, pooled),
    ]);

    if (
      row.workspace.kind !== workspace.kind ||
      row.workspace.id !== workspace.id ||
      row.workspace.cwd !== workspace.cwd
    ) {
      return undefined;
    }

    return { change, info: { ...row, activation: clientActivation(activation) } };
  };

  /** The row this process or an earlier launch built, while it still answers for the session. */
  const reusable = async (
    pooled: Pooled,
    id: SessionId,
    seq: Seq,
    workspace: Oid | null,
  ): Promise<Reusable | undefined> => {
    const listed = pooled.listed;

    if (listed === undefined) return storedListing(pooled, id, seq);

    if (listed.activation !== pooled.activationState || listed.workspace !== workspace) {
      return undefined;
    }

    const change = await rowChange(pooled.session, listed.seq, seq);

    return change === "rebuild" ? undefined : { change, info: listed.info };
  };

  /**
   * The session's row, or `undefined` when `filter` leaves it out. The cursor
   * is read before anything the row is built from, so a write after it is an
   * event the next read classifies. A row the stream left alone is reused, a
   * row whose facts moved takes them as they are now, and any other row is
   * rebuilt; a rebuild reads the facts first, so a session the filter leaves
   * out never has its history walked.
   */
  const listedInfo = async (
    pooled: Pooled,
    id: SessionId,
    filter: RowFilter,
  ): Promise<SessionInfo | undefined> => {
    const seq = await pooled.session.events.last();
    const workspace = await (await pool.rootOf(pooled)).session.refs.read(WORKSPACE_REF);
    const reused = await reusable(pooled, id, seq, workspace);

    if (reused?.change === "none") {
      pooled.listed = { seq, activation: pooled.activationState, workspace, info: reused.info };

      return admits(filter, reused.info) ? reused.info : undefined;
    }

    const facts = await pool.readFacts(pooled.session);

    if (reused === undefined && !admits(filter, factFields(facts))) return undefined;

    const info =
      reused === undefined
        ? sessionInfo(await pool.readSession(id, pooled, { facts }))
        : withFacts(reused.info, facts);

    pooled.listed = { seq, activation: pooled.activationState, workspace, info };
    // A cache the next launch reads; a store that cannot keep it costs that launch a walk, nothing more.
    await pooled.session.listing.write({ seq, body: encodeListing(info) }).catch(() => undefined);

    return admits(filter, info) ? info : undefined;
  };

  const listedSession = async (
    stored: { readonly id: string; readonly createdAt: number },
    filter: RowFilter & { readonly search?: string },
  ): Promise<SessionInfo | undefined> => {
    const id = sessionId(stored.id);

    try {
      const pooled = await pool.open(id);
      pooled.createdAt ??= stored.createdAt;
      const info = await listedInfo(pooled, id, filter);

      if (info === undefined) return undefined;

      if (filter.search !== undefined && !matches(info, filter.search)) return undefined;

      return info;
    } catch (error) {
      if (error instanceof UnknownSession) return undefined;

      // One unreadable session leaves the directory; it must not close the workspace.
      if (error instanceof CorruptObject) {
        process.emitWarning(`Session ${id} is unreadable: ${error.message}`, "CorruptSession");

        return undefined;
      }

      throw error;
    }
  };

  /**
   * The row a client acts on. Its history comes through the listing reader;
   * what lives outside the session's stream is read now, as a full read
   * would: the tree's workspace (a child inherits its root's, legacy `cwd`
   * included) and the host's answer for it, both through history-free
   * ancestry, and every run's lease, which is taken, renewed, and expires
   * without an event.
   */
  const get = async (input: {
    readonly sessionId: SessionId;
  }): Promise<SessionInfo | undefined> => {
    pool.alive();

    try {
      const pooled = await pool.open(input.sessionId);
      const row = await listedInfo(pooled, input.sessionId, { includeArchived: true });

      if (row === undefined) return undefined;

      const [workspace, activation, heads] = await Promise.all([
        pool.storedWorkspace(pooled),
        pool.resolveSessionActivation(input.sessionId, pooled),
        Promise.all(
          row.heads.map(async (head) =>
            head.run === undefined
              ? head
              : {
                  ...head,
                  run: withLease(head.run, await pooled.session.leases.read(headRef(head.head))),
                },
          ),
        ),
      ]);

      return {
        ...row,
        activation: clientActivation(activation),
        workspace: workspaceRef(workspace),
        heads,
      };
    } catch (error) {
      if (error instanceof UnknownSession) return undefined;
      throw error;
    }
  };

  const snapshot = async (input: { readonly sessionId: SessionId; readonly head?: HeadName }) => {
    pool.alive();

    try {
      const pooled = await pool.open(input.sessionId);
      const { session } = pooled;
      // Read the cursor first. A commit may land before the remaining reads,
      // so a watch from this seq can replay a commit already in the snapshot.
      // appendTranscriptCommit returns undefined and the client refolds.
      const seq = await session.events.last();
      const head = input.head ?? MAIN;
      // Each queue must precede its branch read, including a non-main selection.
      const selectedPending = head === MAIN ? undefined : await pending(session, head);
      const data = await pool.readSession(input.sessionId, pooled);
      // A side branch is one chain query against the store, so nothing is
      // reused across requests: never a mutable ref or pooled cache.
      const selected = data.heads.find((item) => item.head === head);
      const tip = selected === undefined ? await session.refs.read(headRef(head)) : selected.tip;

      const [commits, run, compaction] = await Promise.all([
        head === MAIN ? data.commits : branch(session.objects, tip),
        selected === undefined ? pool.currentRun(session, head) : selected.run,
        activeCompaction(session, head),
      ]);

      const projected = projectContext(
        pooled,
        head === MAIN ? data.mainCommits : commits.map((item) => item.commit),
        run,
      );

      const parked =
        run === undefined ? [] : orderParkedCalls(await pool.parkedCalls(session, run), commits);

      const snapshot = {
        seq,
        session: sessionInfo(data),
        head,
        tip,
        config: projected.config,
        transcript: transcriptFromCommits(commits, { run, parked }),
        pending: pendingItems(selectedPending ?? data.pendingChanges),
        context: projected.status,
        usage: projected.usage,
      };

      const withRun = run === undefined ? snapshot : { ...snapshot, run };
      const withCompaction = compaction === undefined ? withRun : { ...withRun, compaction };

      return parked.length === 0 ? withCompaction : { ...withCompaction, parked };
    } catch (error) {
      if (error instanceof UnknownSession) return undefined;
      throw error;
    }
  };

  /**
   * Reuses the history read needed for session info; a side head adds its own
   * branch. Skips transcript and parked-call projection and sends no transcript
   * or queue, so metadata refreshes avoid that projection and transport cost.
   */
  const metadata = async (input: { readonly sessionId: SessionId; readonly head?: HeadName }) => {
    pool.alive();

    try {
      const pooled = await pool.open(input.sessionId);
      const { session } = pooled;
      const head = input.head ?? MAIN;
      const data = await pool.readSession(input.sessionId, pooled);
      const selected = data.heads.find((item) => item.head === head);
      const tip = selected === undefined ? await session.refs.read(headRef(head)) : selected.tip;
      const items = head === MAIN ? undefined : await branch(session.objects, tip);
      const commits = items === undefined ? data.mainCommits : items.map((item) => item.commit);
      const run = selected === undefined ? await pool.currentRun(session, head) : selected.run;
      const projected = projectContext(pooled, commits, run);

      return {
        session: sessionInfo(data),
        head,
        config: projected.config,
        context: projected.status,
        usage: projected.usage,
      };
    } catch (error) {
      if (error instanceof UnknownSession) return undefined;
      throw error;
    }
  };

  const list = async (
    input: {
      readonly search?: string;
      readonly limit?: number;
      readonly cursor?: string;
      readonly parent?: SessionId | null;
      readonly includeArchived?: boolean;
    } = {},
  ) => {
    pool.alive();
    // Newest first: a directory and a bounded search answer with the sessions
    // in use. The store lists roots before their children, which attachment
    // and relocation walk in that order, so the reversal is here.
    const all = (await options.store.list()).toReversed();
    const parsed = input.cursor === undefined ? 0 : Number.parseInt(input.cursor, 10);
    const start = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    const limit = input.limit ?? all.length;
    const search = input.search?.toLowerCase();
    const items: SessionInfo[] = [];
    // Rows are examined in listing order, a bounded batch at a time. `next` is
    // the index after the last examined row, where a one-at-a-time walk stops.
    let index = start;

    while (index < all.length && items.length < limit) {
      const batch = all.slice(index, index + LIST_BATCH);

      // A row past the one that fills the page was read speculatively; its
      // failure is not this page's failure.
      const examined = await Promise.allSettled(
        batch.map((stored) => listedSession(stored, { ...input, search })),
      );

      for (const outcome of examined) {
        if (outcome.status === "rejected") throw outcome.reason;
        index += 1;

        if (outcome.value === undefined) continue;
        items.push(outcome.value);

        if (items.length >= limit) break;
      }
    }

    return index < all.length ? { items, next: String(index) } : { items };
  };

  const context = async (input: { readonly sessionId: SessionId; readonly head?: HeadName }) => {
    pool.alive();
    const pooled = await pool.open(input.sessionId);
    const { session } = pooled;
    const head = input.head ?? MAIN;
    const tip = await session.refs.read(headRef(head));

    const [commits, run] = await Promise.all([
      branch(session.objects, tip),
      pool.currentRun(session, head),
    ]);

    return projectContext(
      pooled,
      commits.map((item) => item.commit),
      run,
    ).status;
  };

  const liveTrees = new WeakMap<
    Pooled,
    Map<HeadName, { readonly seq: number; readonly cwd: string; readonly tree: TreeOutcome }>
  >();

  const runTrees = async (input: { readonly sessionId: SessionId; readonly head?: HeadName }) => {
    const pooled = await pool.open(input.sessionId);
    const session = pooled.session;
    const state = await pool.resolveSessionActivation(input.sessionId, pooled);
    const cwd = state.kind === "active" && pool.served(state.env) ? state.env.cwd : null;

    const head = input.head ?? MAIN;

    const [tip, currentRun] = await Promise.all([
      session.refs.read(headRef(head)),
      pool.currentRun(session, head),
    ]);

    const commits = (await branch(session.objects, tip)).map((item) => item.commit);

    return { commits, currentRun, pooled, cwd, head };
  };

  const treesForRun = (trees: Awaited<ReturnType<typeof runTrees>>, runId: string) => {
    const commits = trees.commits.filter((commit) => commit.run === runId);

    const live =
      trees.currentRun?.runId === runId && !isTerminalPhase(trees.currentRun.phase)
        ? trees.currentRun
        : undefined;

    let from: TreeId | undefined;

    for (const commit of commits) {
      if ("start" in commit && commit.start.kind === "run") {
        from = commit.start.tree ?? undefined;
        break;
      }
    }

    return { ...trees, commits, live, from };
  };

  const lastResultTree = (commits: readonly Commit[]): TreeId | undefined => {
    const commit = commits.findLast((candidate) => "call" in candidate && candidate.tree !== null);

    return commit !== undefined && "call" in commit ? (commit.tree ?? undefined) : undefined;
  };

  const recordedDiff = (commits: readonly Commit[]): readonly FileDiff[] => {
    const files: FileDiff[] = [];

    for (const commit of commits) {
      if (commit.body.kind !== "message" || commit.body.message.role !== "toolResult") continue;

      if (commit.body.message.isError) continue;

      if (!("call" in commit)) continue;
      const settled = commit.call;

      if (settled.kind !== "file_patch") continue;
      files.push({
        path: settled.path,
        kind:
          settled.removed === 0 && settled.patch.startsWith("--- /dev/null") ? "added" : "modified",
        added: settled.added,
        removed: settled.removed,
        patch: settled.patch,
      });
    }

    return files;
  };

  const diffRun = async (
    trees: Awaited<ReturnType<typeof runTrees>>,
    runId: string,
  ): Promise<RunDiff> => {
    const { commits, live, from, pooled, cwd, head } = treesForRun(trees, runId);

    if (commits.length === 0) return { kind: "not_found" };
    const vcs = options.workspace?.vcs;

    if (vcs !== undefined && from !== undefined && cwd !== null) {
      const seq = await pooled.session.events.last();
      const cached = liveTrees.get(pooled)?.get(head);

      const current =
        live === undefined
          ? undefined
          : cached !== undefined && cached.seq === seq && cached.cwd === cwd
            ? cached.tree
            : await vcs.tree({ cwd }).then((tree) => {
                const trees = liveTrees.get(pooled) ?? new Map();
                trees.set(head, { seq, cwd, tree });
                liveTrees.set(pooled, trees);

                return tree;
              });

      const to = current?.kind === "tree" ? current.id : lastResultTree(commits);

      if (to !== undefined) {
        const files = await vcs.diffTrees({ cwd, from, to });

        return { kind: "tree", from, to, files };
      }
    }

    return { kind: "recorded", files: recordedDiff(commits) };
  };

  const diff = async (
    input: OperationInput<"runs.diff">,
  ): Promise<OperationOutput<"runs.diff">> => {
    pool.alive();
    const trees = await runTrees(input);

    return Promise.all(
      input.runs.map(async (run) => ({
        run,
        diff: await diffRun(trees, run),
      })),
    );
  };

  const revert = async (
    input: OperationInput<"runs.revert"> & { readonly expect: TreeId },
  ): Promise<RunRevertOutcome> => {
    pool.alive();
    const trees = await runTrees(input);
    const { commits, live, from, cwd } = treesForRun(trees, input.runId);

    if (commits.length === 0) return { kind: "not_found" };

    if (live !== undefined) return { kind: "busy", run: live };
    const vcs = options.workspace?.vcs;
    const to = lastResultTree(commits);

    if (vcs === undefined || from === undefined || to === undefined || cwd === null) {
      return { kind: "no_tree" };
    }

    const files = await vcs.diffTrees({ cwd, from, to });

    const restored = await vcs.restoreTree({
      cwd,
      from,
      expect: input.expect,
      paths: files,
    });

    switch (restored.kind) {
      case "restored":
        return { kind: "reverted", files: restored.files };
      case "conflict":
      case "failed":
        return restored;
      default: {
        const _exhaustive: never = restored;

        return _exhaustive;
      }
    }
  };

  return { get, snapshot, metadata, list, context, diff, revert };
}
