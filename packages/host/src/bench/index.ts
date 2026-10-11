import type { PartId, Seq, SessionId } from "@nyte-ai/schema";
import type { ConnectOptions, Connection, Host, Store } from "@nyte-ai/core";
import type { FakeModel } from "./fake-models.ts";

export type { FakeModel, ScriptedTurn } from "./fake-models.ts";

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
  return {
    name: "host",
    async open() {
      throw new Error("not implemented");
    },
  };
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
 * else 0). `crash()` severs the running view and keeps that host for
 * `close()`; `restart()` crashes first when a kernel still runs, then opens the
 * next. `counters` are `gitDiffReads` and `bench_memo_runs`, and `ids` brand
 * with `asId` and `asSeq`. `close()` closes every link, the running and the
 * crashed hosts, the store, and removes the temp directory.
 */
async function openBench(
  options: Parameters<BenchDriver["open"]>[0],
  connect: BenchConnect | undefined,
): Promise<BenchHost> {
  throw new Error("not implemented");
}

/**
 * Opens one `BenchLink` to a running host: `listen` over `http` with a random
 * token, a `cuttableLink` in front, and `connect({ url, credentials: { kind:
 * "token", token } })` dialling the link.
 *
 * `drop` and `restore` are the link's; `close()` closes the connection, the
 * link and the listener, once.
 */
async function linkTo(host: Host, connect: BenchConnect): Promise<BenchLink> {
  throw new Error("not implemented");
}
