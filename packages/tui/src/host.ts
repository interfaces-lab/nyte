/**
 * The terminal host over the SDK: one store worker and one `Nyte` per
 * workspace, composed the way the design record says a host composes
 * (`createNyte` with a store, a stream function, a model catalog, plugins
 * behind trust) and volunteered as a runner with `attach()`.
 *
 * Everything the client draws goes through SDK operations. The two reads that
 * span more than a branch, the session tree and the usage panel, are host
 * reads over the store entry's documented contract (design record, "Roles").
 */
import { emptyUsageSummary, mergeUsageSummaries, projectUsage, sessionId } from "@nyte-ai/core";
import type {
  Disposer,
  LoadedPlugin,
  Nyte,
  SessionId,
  TrustedWorkspace,
  UsageSummary,
} from "@nyte-ai/core";
import { WorkerStore } from "@nyte-ai/core/store";
import type { Store } from "@nyte-ai/core/store";
import type { Session } from "@nyte-ai/core/store";
import { createHost } from "@nyte-ai/host";
import type { HostOptions } from "@nyte-ai/host";
import type { Usage } from "@nyte-ai/schema";

type StoredCommit = Awaited<ReturnType<Session["objects"]["commits"]>>[number];

interface HostCloseFailure {
  readonly resource: "sdk" | "store";
  readonly cause: unknown;
}

export type HostCloseOutcome =
  | { readonly kind: "closed" }
  | {
      readonly kind: "failed";
      readonly failures: readonly HostCloseFailure[];
    };

interface OpenHostOptions extends Omit<HostOptions, "store"> {
  readonly cwd: string;
  readonly storePath: string;
  /** How often the store polls for writes from other processes. */
  readonly watchPollIntervalMs?: number;
}

export interface WorkspaceUsage {
  /** Chats that recorded any usage. */
  readonly chats: number;
  readonly workspace: UsageSummary;
  /** The active chat's share, zero when it has no usage yet. */
  readonly current: UsageSummary;
}

function hasUsage(usage: Usage): boolean {
  return usage.totalTokens > 0 || usage.cost.total > 0;
}

export class Host {
  readonly nyte: Nyte;
  readonly store: Store;
  readonly cwd: string;
  private closing: Promise<HostCloseOutcome> | undefined;

  private constructor(nyte: Nyte, store: Store, cwd: string) {
    this.nyte = nyte;
    this.store = store;
    this.cwd = cwd;
  }

  static async open(options: OpenHostOptions): Promise<Host> {
    const { cwd, storePath, watchPollIntervalMs, ...host } = options;
    // SQLite work runs in a worker so the rendering thread never waits on it.
    const store = new WorkerStore({
      path: storePath,
      worker: storeWorkerLocation(),
      ...(watchPollIntervalMs === undefined ? {} : { watchPollIntervalMs }),
    });
    try {
      await store.ready();
      return new Host(await createHost({ ...host, store }), store, cwd);
    } catch (cause) {
      await store.close().catch(() => undefined);
      throw cause;
    }
  }

  /** Volunteer this process as the runner for one session and its children. */
  attach(id: SessionId): Disposer {
    return this.nyte.attach({ sessions: [id] });
  }

  /** The conversation's execution directory, independent of this host's database directory. */
  async sessionCwd(id: SessionId): Promise<string> {
    return (await this.nyte.sessionCwd({ sessionId: id })) ?? this.cwd;
  }

  /** The caller validates destination trust and resolves its plugins before changing location. */
  relocate(id: SessionId, workspace: TrustedWorkspace, plugins: readonly LoadedPlugin[]) {
    return this.nyte.relocate({ sessionId: id, workspace, plugins });
  }

  /**
   * Every commit the session holds, on every branch, oldest first. The tree
   * picker needs the abandoned branches a head no longer names, which no
   * branch operation returns.
   */
  async sessionCommits(id: SessionId): Promise<readonly StoredCommit[]> {
    const session = await this.store.open(id);
    try {
      return await session.objects.commits();
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  /** Usage across every session in the workspace: one read-only pass over the store. */
  async workspaceUsage(currentSessionId: SessionId): Promise<WorkspaceUsage> {
    let workspace = emptyUsageSummary();
    let current = emptyUsageSummary();
    let chats = 0;
    for (const { id } of await this.store.list()) {
      const info = await this.nyte.sessions.get({ sessionId: sessionId(id) });
      if (info === undefined) continue;
      const session = await this.store.open(id);
      let commits: readonly StoredCommit[];
      try {
        commits = await session.objects.commits();
      } finally {
        await session.close().catch(() => undefined);
      }
      const summary = projectUsage(commits.map((item) => item.commit));
      if (!hasUsage(summary.total)) continue;
      chats += 1;
      workspace = mergeUsageSummaries(workspace, summary);
      if (info.sessionId === currentSessionId) current = summary;
    }
    return { chats, workspace, current };
  }

  /** Best-effort shutdown; every caller observes the same settlement and original causes. */
  close(): Promise<HostCloseOutcome> {
    this.closing ??= Promise.resolve().then(async (): Promise<HostCloseOutcome> => {
      const failures: HostCloseFailure[] = [];
      try {
        await this.nyte.close();
      } catch (cause) {
        failures.push({ resource: "sdk", cause });
      }
      try {
        await this.store.close();
      } catch (cause) {
        failures.push({ resource: "store", cause });
      }
      return failures.length === 0 ? { kind: "closed" } : { kind: "failed", failures };
    });
    return this.closing;
  }
}

/**
 * `scripts/build-binary.mjs` compiles the worker as a second entry, and Bun
 * embeds entries under their common root (`packages/`) with a `.js` suffix.
 * From source the worker is the module beside `WorkerStore`.
 */
function storeWorkerLocation(): URL {
  const compiled = import.meta.url.startsWith("file:///$bunfs/");
  return compiled
    ? new URL("file:///$bunfs/root/core/src/kernel/store-worker.js")
    : new URL("../../core/src/kernel/store-worker.ts", import.meta.url);
}
