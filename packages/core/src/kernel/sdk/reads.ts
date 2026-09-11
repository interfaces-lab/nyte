/**
 * Read-only projections a client draws from a pooled session: the session
 * page, the snapshot a watch starts from, context status, and file changes.
 * Nothing here instantiates plugins or moves a ref.
 */
import type { Api, Model } from "@nyte-ai/schema";
import { activeCompaction } from "../compaction.ts";
import { branch } from "../graph.ts";
import type { Commit, Oid } from "../model.ts";
import { headRef } from "../names.ts";
import { pending } from "../queue.ts";
import { changesFromTurns, projectContextStatus, transcriptFromCommits } from "../views/index.ts";
import type { Pooled, SessionPool } from "./session-pool.ts";
import {
  ARCHIVED_FACT,
  PARENT_FACT,
  headConfig,
  parentFromFact,
  pendingItems,
  sessionInfo,
} from "./snapshot.ts";
import {
  MAIN,
  UnknownSession,
  sessionId,
  type HeadName,
  type NyteOptions,
  type RunId,
  type RunInfo,
  type SessionId,
  type SessionInfo,
} from "./types.ts";

/** Sessions examined at once by `sessions.list`; bounds open handles and store reads per page. */
const LIST_BATCH = 8;

function matches(info: SessionInfo, needle: string): boolean {
  return (
    (info.name ?? "").toLowerCase().includes(needle) ||
    (info.preview ?? "").toLowerCase().includes(needle)
  );
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
        : pooled.activation?.registries.modelContext.get(`${model.provider}/${model.id}`);
    const checkpoint = commits.findLastIndex((commit) => commit.body.kind === "checkpoint");
    return {
      config,
      status: projectContextStatus(
        checkpoint < 0 ? commits : commits.slice(checkpoint),
        policy?.contextWindow ?? model?.contextWindow ?? 0,
        model === undefined
          ? undefined
          : { provider: model.provider, api: model.api, model: model.id },
      ),
    };
  };

  /** One listing row as a session row; `undefined` when a filter drops it or the session is gone. */
  const listedSession = async (
    stored: { readonly id: string; readonly createdAt: number },
    filter: {
      readonly search?: string;
      readonly parent?: SessionId | null;
      readonly includeArchived?: boolean;
    },
  ): Promise<SessionInfo | undefined> => {
    const id = sessionId(stored.id);
    try {
      const pooled = await pool.open(id);
      pooled.createdAt ??= stored.createdAt;
      const facts = await pool.readFacts(pooled.session);
      if (facts.get(ARCHIVED_FACT) === true && filter.includeArchived !== true) return undefined;
      const parent = parentFromFact(facts.get(PARENT_FACT));
      if (filter.parent === null && parent !== undefined) return undefined;
      if (
        filter.parent !== undefined &&
        filter.parent !== null &&
        parent?.sessionId !== filter.parent
      ) {
        return undefined;
      }
      const info = sessionInfo(await pool.readSession(id, pooled, { facts }));
      if (filter.search !== undefined && !matches(info, filter.search)) return undefined;
      return info;
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
      const parked = run === undefined ? [] : await pool.parkedCalls(session, run);
      const snapshot = {
        seq,
        session: sessionInfo(data),
        head,
        tip,
        config: projected.config,
        transcript: transcriptFromCommits(commits),
        pending: pendingItems(selectedPending ?? data.pendingChanges),
        context: projected.status,
      };
      const withRun = run === undefined ? snapshot : { ...snapshot, run };
      const withCompaction = compaction === undefined ? withRun : { ...withRun, compaction };
      return parked.length === 0 ? withCompaction : { ...withCompaction, parked };
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
    const all = await options.store.list();
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

  const changes = async (input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly runId?: RunId;
  }) => {
    pool.alive();
    const session = (await pool.open(input.sessionId)).session;
    const tip = await session.refs.read(headRef(input.head ?? MAIN));
    const commits = await branch(session.objects, tip);
    if (input.runId === undefined) {
      return changesFromTurns(transcriptFromCommits(commits));
    }
    const selected = commits.filter((item) => item.commit.run === input.runId);
    if (selected.length === 0) return [];
    let parent: Oid | null = null;
    const contiguous = selected.map((item) => {
      const projected = { oid: item.oid, commit: { ...item.commit, parent } };
      parent = item.oid;
      return projected;
    });
    return changesFromTurns(transcriptFromCommits(contiguous));
  };

  return { snapshot, list, context, changes };
}
