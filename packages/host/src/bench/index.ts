import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId, asSeq } from "@nyte-ai/schema";
import type { PartId, Seq, SessionId } from "@nyte-ai/schema";
import { SdkError, memoryStore } from "@nyte-ai/core";
import type { ConnectOptions, Connection, Host, Store } from "@nyte-ai/core";
import { localProvider } from "../local/provider.ts";
import { openHost } from "../open.ts";
import { fakeModels, scriptedModel } from "./fake-models.ts";
import type { FakeModel } from "./fake-models.ts";
import { countingGit, gitFixture, seedSessions } from "./fixtures.ts";
import { cuttableLink } from "./link.ts";
import { severableStore } from "./store.ts";
import { benchTools } from "./tools.ts";

export { chatOnly, fakeModels, testModel } from "./fake-models.ts";
export type { FakeModel, FakeModels, Reply, Request, ScriptedTurn } from "./fake-models.ts";

/** One open bench fixture (`BenchHost` in `packages/bench/src/driver.ts`): the host, its model and store, crash and restart, a cuttable client link, counters and id constructors. */
export interface BenchHost {
  /** The running host; after `restart()`, the new one. */
  readonly host: Host;
  readonly model: FakeModel;
  readonly store: Store;
  /** Ends the kernel process-like: no cleanup, no settlement. The store survives. */
  crash(): Promise<void>;
  /** Opens a new kernel over the same store. The returned host replaces `host`. */
  restart(): Promise<Host>;
  /** A connection over the listener, so link loss can be simulated. */
  connect(): Promise<BenchLink>;
  /** Counts of what the environment and the bench tools did, by name. */
  readonly counters: Readonly<Record<string, () => number>>;
  /** Branded ids the bench cannot construct itself. */
  readonly ids: {
    session(name: string): SessionId;
    part(name: string): PartId;
    seq(n: number): Seq;
  };
  close(): Promise<void>;
}

/** One client connection over a cuttable link (`BenchLink` in `packages/bench/src/driver.ts`). */
export interface BenchLink {
  readonly connection: Connection;
  /** Cuts the socket; the connection reports reconnecting until `restore()`. */
  drop(): void;
  restore(): void;
  /** Bytes the host has sent this client since the link opened. */
  received(): number;
  close(): Promise<void>;
}

/** What `packages/bench` runs its scenarios against (`BenchDriver` in `packages/bench/src/driver.ts`). */
export interface BenchDriver {
  readonly name: string;
  open(options?: {
    readonly sessions?: number;
    readonly messagesPerSession?: number;
    readonly changedFiles?: number;
  }): Promise<BenchHost>;
}

/**
 * Returns the client side of `BenchHost.connect`: `sdk.connect`'s signature,
 * passed in because the sdk depends on this package and this package cannot
 * depend on it back (§43h).
 */
export type BenchConnect = (options: ConnectOptions) => Promise<Connection>;

/**
 * Returns the host package's `BenchDriver`, named `host`, whose `open` is
 * `openBench` with `connect`.
 *
 * Without `connect`, `BenchHost.connect()` rejects `SdkError("unavailable")`
 * before listening, so until the sdk exists `reconnect-resume` cannot run.
 */
export function createBenchDriver(options?: { readonly connect?: BenchConnect }): BenchDriver {
  return { name: "host", open: (input) => openBench(input, options?.connect) };
}

/** The driver `packages/bench/src/main.ts` imports: `createBenchDriver()` with no client, so every scenario but `reconnect-resume` runs. */
export const benchDriver: BenchDriver = createBenchDriver();

/**
 * Builds one fixture: a temp directory (`mkdtemp` under `os.tmpdir()`)
 * holding `home/` and `workspace/` (a repository with `changedFiles` modified
 * files by `gitFixture` when given) and a `countingGit`; one `memoryStore()`
 * for the fixture's life; and `scriptedModel` over a `bench` provider with one
 * model and a short-text `fallback`.
 *
 * Each kernel is `openHost` over its own `severableStore` view of that store,
 * with those models, `home`, a fixed random 32-byte `secrets` key, the local
 * workspace, and the plugins `localProvider({ home, git: <countingGit> })` and
 * `benchTools`; the first then sets the default model to `model.ref` and runs
 * `seedSessions` (`sessions` default 1 when `messagesPerSession` is given,
 * else 0). `crash()` severs the running view, then closes that host,
 * its store calls already refused, so its turns, jobs and timers stop and
 * nothing it does on the way out writes (§43k); `restart()` crashes first
 * when a kernel still runs, then opens the next. `counters` are `gitDiffReads` and `bench_memo_runs`, and `ids` brand
 * with `asId` and `asSeq`. `close()` closes every link, the running host and the
 * store, and removes the temp directory.
 */
async function openBench(
  options: Parameters<BenchDriver["open"]>[0],
  connect: BenchConnect | undefined,
): Promise<BenchHost> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-bench-")));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  await Promise.all([mkdir(home), mkdir(workspace)]);

  if (options?.changedFiles !== undefined) await gitFixture(workspace, options.changedFiles);
  const git = await countingGit(join(root, "bin"));
  const store = memoryStore();
  const fake = fakeModels({ id: "bench", fallback: { content: [{ type: "text", text: "ok" }] } });
  const model = scriptedModel(fake);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  let memoRuns = 0;

  const tools = benchTools(() => {
    memoRuns += 1;
  });

  const kernel = async (): Promise<{ readonly host: Host; sever(): void }> => {
    const view = severableStore(store);

    const host = await openHost({
      store: view.store,
      models: fake.models,
      plugins: [{ id: "local", environment: localProvider({ home, git: git.path }) }, tools],
      workspace: { kind: "local", path: workspace },
      home,
      secrets: { key: async () => secret },
    });

    return { host, sever: () => view.sever() };
  };

  let running: { readonly host: Host; sever(): void } | null = await kernel();
  let current = running.host;
  const links = new Set<BenchLink>();
  await current.models.setDefault(model.ref);

  await seedSessions(current, {
    sessions: options?.sessions ?? (options?.messagesPerSession === undefined ? 0 : 1),
    messagesPerSession: options?.messagesPerSession ?? 0,
  });

  const crash = async (): Promise<void> => {
    if (running === null) return;
    const dead = running;
    running = null;
    dead.sever();
    await dead.host.close().catch(() => undefined);
  };

  let closing: Promise<void> | null = null;

  return {
    get host() {
      return current;
    },
    model,
    store,
    crash,
    async restart() {
      await crash();
      running = await kernel();
      current = running.host;

      return current;
    },
    async connect() {
      if (connect === undefined)
        throw new SdkError("unavailable", "This bench driver was made without a client connect.");

      if (running === null) throw new SdkError("unavailable", "The bench host has crashed.");
      const link = await linkTo(running.host, connect);
      links.add(link);

      return link;
    },
    counters: { gitDiffReads: () => git.reads(), bench_memo_runs: () => memoRuns },
    ids: {
      session: (name) => asId<"session">(name),
      part: (name) => asId<"part">(name),
      seq: (n) => asSeq(n),
    },
    close() {
      closing ??= (async () => {
        for (const link of links) await link.close();
        await running?.host.close();
        await store.close();
        await rm(root, { recursive: true, force: true });
      })();

      return closing;
    },
  };
}

/**
 * Opens one `BenchLink` to a running host: `listen` over `http` with a random
 * token, a `cuttableLink` in front, and `connect({ url, credentials: { kind:
 * "token", token } })` dialling the link.
 *
 * `drop`, `restore` and `received` are the link's; `close()` closes the connection, the
 * link and the listener, once.
 */
async function linkTo(host: Host, connect: BenchConnect): Promise<BenchLink> {
  const token = `bench-${crypto.randomUUID()}`;

  const listener = await host.listen({
    transport: { kind: "http", port: 0 },
    auth: { kind: "token", token },
  });

  if (listener.address === null) {
    await listener.close();

    throw new SdkError("internal", "The bench listener has no address.");
  }

  const link = await cuttableLink(listener.address);

  const connection = await connect({
    url: link.url,
    credentials: { kind: "token", token },
  }).catch(async (error: unknown) => {
    await link.close();
    await listener.close();

    throw error;
  });

  let closing: Promise<void> | null = null;

  return {
    connection,
    drop: () => link.drop(),
    restore: () => link.restore(),
    received: () => link.received(),
    close() {
      closing ??= (async () => {
        await connection.close();
        await link.close();
        await listener.close();
      })();

      return closing;
    },
  };
}
