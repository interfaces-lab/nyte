/**
 * The terminal host over the SDK: one store worker and one `Nyte` per
 * workspace, composed with `createNyte` (a store, a stream function, a model
 * catalog, plugins behind trust) and volunteered as a runner with `attach()`.
 */
import type { Disposer, Nyte, SessionId } from "@nyte-ai/core";
import { WorkerStore } from "@nyte-ai/core/store";
import type { Store } from "@nyte-ai/core/store";
import type { Session } from "@nyte-ai/core/store";
import { createHost } from "@nyte-ai/host";
import type { HostOptions } from "@nyte-ai/host";
import { createBunPluginSources } from "./plugin-loader.ts";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";

type StoredCommit = Awaited<ReturnType<Session["objects"]["commits"]>>[number];

interface HostCloseFailure {
  readonly resource: "sdk" | "plugins" | "store";
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

export class Host {
  readonly nyte: Nyte;
  readonly store: Store;
  readonly cwd: string;
  readonly storePath: string;
  readonly pluginSources: ReturnType<typeof createBunPluginSources>;
  private closing: Promise<HostCloseOutcome> | undefined;

  private constructor(
    nyte: Nyte,
    store: Store,
    options: Pick<OpenHostOptions, "cwd" | "storePath">,
    pluginSources: ReturnType<typeof createBunPluginSources>,
  ) {
    this.nyte = nyte;
    this.store = store;
    this.cwd = options.cwd;
    this.storePath = options.storePath;
    this.pluginSources = pluginSources;
  }

  static async open(options: OpenHostOptions): Promise<Host> {
    const { cwd, storePath, watchPollIntervalMs, ...host } = options;

    // SQLite work runs in a worker so the rendering thread never waits on it.
    const storeOptions = { path: storePath, worker: storeWorkerLocation() };

    const store = new WorkerStore(
      watchPollIntervalMs === undefined ? storeOptions : { ...storeOptions, watchPollIntervalMs },
    );

    const pluginSources = createBunPluginSources();

    try {
      await store.ready();
      const plugins =
        host.plugins.kind === "workspace"
          ? {
              ...host.plugins,
              sources: pluginSources,
              codemode: host.plugins.codemode ?? codemodeRuntimeOptions(),
            }
          : host.plugins;

      return new Host(
        await createHost({ ...host, plugins, store }),
        store,
        { cwd, storePath },
        pluginSources,
      );
    } catch (cause) {
      pluginSources.dispose();
      await store.close().catch(() => undefined);
      throw cause;
    }
  }

  /** Volunteer this process as the runner for one session and its children. */
  attach(id: SessionId): Disposer {
    return this.nyte.attach({ sessions: [id] });
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
        this.pluginSources.dispose();
      } catch (cause) {
        failures.push({ resource: "plugins", cause });
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
