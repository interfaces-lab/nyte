/**
 * The terminal host over the SDK: one `SqliteStore` and one `Nyte` per
 * workspace, composed the way the design record says a host composes
 * (`createNyte` with a store, a stream function, a model catalog, plugins
 * behind trust) and volunteered as a runner with `attach()`.
 *
 * Everything the client draws goes through SDK verbs. The two reads that
 * span more than a branch, the session tree and the usage panel, are host
 * reads over the store entry's documented contract (design record, "Roles").
 */
import {
  MAIN,
  createNyte,
  emptyUsageSummary,
  mergeUsageSummaries,
  projectUsage,
  sessionId,
} from "@nyte-ai/core";
import type {
  Actor,
  CompactionSettings,
  Disposer,
  LoadedPlugin,
  ModelCatalog,
  Nyte,
  NyteOptions,
  Oid,
  RunInfo,
  SessionId,
  StreamFn,
  ThinkingLevel,
  UsageSummary,
} from "@nyte-ai/core";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SqliteStore, type Session } from "@nyte-ai/core/store";
import type { Api, Model } from "@nyte-ai/schema";
import type { Usage } from "@nyte-ai/schema";

type StoredObject = NonNullable<Awaited<ReturnType<Session["objects"]["get"]>>>;
type Commit = Extract<StoredObject, { readonly kind: "commit" }>;

export interface StoredCommit {
  readonly oid: Oid;
  readonly commit: Commit;
}

export interface HostOptions {
  readonly cwd: string;
  readonly storePath: string;
  readonly streamFn: StreamFn;
  readonly models: ModelCatalog;
  readonly model: Model<Api>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly plugins: readonly LoadedPlugin[];
  readonly compaction?: CompactionSettings;
  readonly streamOptions?: NyteOptions["streamOptions"];
  readonly actor?: Actor;
  /** How often the store polls for writes from other processes. */
  readonly watchPollIntervalMs?: number;
}

function nyteOptions(store: SqliteStore, options: HostOptions): NyteOptions {
  let composed: NyteOptions = {
    store,
    streamFn: options.streamFn,
    models: options.models,
    model: options.model,
    plugins: options.plugins,
    env: { cwd: options.cwd },
  };
  if (options.thinkingLevel !== undefined) {
    composed = { ...composed, thinkingLevel: options.thinkingLevel };
  }
  if (options.compaction !== undefined) composed = { ...composed, compaction: options.compaction };
  if (options.streamOptions !== undefined) {
    composed = { ...composed, streamOptions: options.streamOptions };
  }
  if (options.actor !== undefined) composed = { ...composed, actor: options.actor };
  return composed;
}

export interface LiveRunUsage {
  readonly sessionId: SessionId;
  /** The session's name, else its id. */
  readonly label: string;
  readonly current: boolean;
  readonly run: RunInfo;
  /** Sum of the run's committed assistant usage. Never the open request. */
  readonly usage: Usage;
}

export interface WorkspaceUsage {
  /** Current chat first, then oldest first. */
  readonly runs: readonly LiveRunUsage[];
  /** Chats that recorded any usage. */
  readonly chats: number;
  readonly workspace: UsageSummary;
  /** The active chat's share, zero when it has no usage yet. */
  readonly current: UsageSummary;
}

function hasUsage(usage: Usage): boolean {
  return usage.totalTokens > 0 || usage.cost.total > 0;
}

function runUsage(commits: readonly StoredCommit[], runId: string): Usage {
  return projectUsage(commits.flatMap((item) => (item.commit.run === runId ? [item.commit] : [])))
    .total;
}

export class Host {
  readonly nyte: Nyte;
  readonly store: SqliteStore;
  readonly cwd: string;
  private closed = false;

  private constructor(nyte: Nyte, store: SqliteStore, cwd: string) {
    this.nyte = nyte;
    this.store = store;
    this.cwd = cwd;
  }

  static async open(options: HostOptions): Promise<Host> {
    // The store lives under `.nyte/`, which a fresh workspace does not have yet.
    await mkdir(dirname(options.storePath), { recursive: true });
    const store = new SqliteStore(
      options.storePath,
      options.watchPollIntervalMs === undefined
        ? undefined
        : { watchPollIntervalMs: options.watchPollIntervalMs },
    );
    try {
      const nyte = await createNyte(nyteOptions(store, options));
      return new Host(nyte, store, options.cwd);
    } catch (cause) {
      await store.close().catch(() => undefined);
      throw cause;
    }
  }

  /** Volunteer this process as a runner for every session in the store. */
  attach(): Disposer {
    return this.nyte.attach();
  }

  /**
   * Every commit the session holds, on every branch, oldest first. The tree
   * picker needs the abandoned branches a head no longer names, which no
   * branch verb returns.
   */
  async sessionCommits(id: SessionId): Promise<StoredCommit[]> {
    const session = await this.store.open(id);
    try {
      return await readCommits(session);
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  /** Usage across every session in the workspace: one read-only pass over the store. */
  async workspaceUsage(currentSessionId: SessionId): Promise<WorkspaceUsage> {
    let workspace = emptyUsageSummary();
    let current = emptyUsageSummary();
    const runs: LiveRunUsage[] = [];
    let chats = 0;
    for (const { id } of await this.store.list()) {
      const info = await this.nyte.sessions.get({ sessionId: sessionId(id) });
      if (info === undefined) continue;
      const session = await this.store.open(id);
      let commits: StoredCommit[];
      try {
        commits = await readCommits(session);
      } finally {
        await session.close().catch(() => undefined);
      }
      const summary = projectUsage(commits.map((item) => item.commit));
      const run = await this.nyte.runs.current({ sessionId: info.sessionId, head: MAIN });
      if (run !== undefined && !["done", "aborted", "failed"].includes(run.phase.kind)) {
        runs.push({
          sessionId: info.sessionId,
          label: info.name ?? info.sessionId,
          current: info.sessionId === currentSessionId,
          run,
          usage: runUsage(commits, run.runId),
        });
      }
      if (!hasUsage(summary.total)) continue;
      chats += 1;
      workspace = mergeUsageSummaries(workspace, summary);
      if (info.sessionId === currentSessionId) current = summary;
    }
    runs.sort(
      (left, right) =>
        Number(right.current) - Number(left.current) || left.run.startedAt - right.run.startedAt,
    );
    return { runs, chats, workspace, current };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.nyte.close().catch(() => undefined);
    await this.store.close().catch(() => undefined);
  }
}

async function readCommits(session: Session): Promise<StoredCommit[]> {
  const commits: StoredCommit[] = [];
  for (const { oid } of await session.objects.list()) {
    const object = await session.objects.get(oid);
    if (object?.kind === "commit") commits.push({ oid, commit: object });
  }
  commits.sort(
    (left, right) => left.commit.at - right.commit.at || left.oid.localeCompare(right.oid),
  );
  return commits;
}
