import { asId } from "@nyte-ai/schema";
import type {
  Configuration,
  DurableEvent,
  HeadName,
  PartId,
  RefUpdate,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  Usage,
  WorkspaceId,
} from "@nyte-ai/schema";
import { createHost } from "./api/connection.ts";
import { createHostState } from "./api/host.ts";
import { createKernel } from "./compose.ts";
import { begin, newRun } from "./engine/runs.ts";
import { publishSet } from "./fold/watch.ts";
import { envelope, leaseRef, memoryStore, partRef, workspaceRef } from "./store.ts";
import type { Kernel, TurnDriver } from "./contract/kernel.ts";
import type {
  EnvironmentProvider,
  ExecutionEnv,
  Host,
  Plugin,
  SnapshotsApi,
  StoreConnection,
} from "./index.ts";
import type { PartRecord, WorkspaceRecord } from "./store.ts";

/** The head a test session drives. */
export const main: HeadName = asId("main");

export const workspace: WorkspaceId = asId("w1");

export const configuration: Configuration = {
  kind: "exact",
  model: { provider: "test", id: "model" },
  thinking: "off",
  agent: null,
  settings: {},
  settingsVersion: "1",
};

export const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const completed: RunEnd = { kind: "completed", usage };

export const env: ExecutionEnv = {
  identity: asId("identity"),
  cwd: "/tmp/project",
  files: {
    read: refuse,
    bytes: refuse,
    stat: refuse,
    write: refuse,
    remove: refuse,
    batch: () => {
      throw new Error("No files in tests.");
    },
    format: refuse,
    scan: refuseStream,
    find: refuse,
    search: refuseStream,
    watch: refuseStream,
    upload: refuse,
  },
  exec: refuse,
  close: async () => undefined,
};

/** One turn the scripted driver started: its input, and `finish` to end it (`completed` by default). */
export interface Turn {
  readonly input: Parameters<TurnDriver["run"]>[0];
  finish(end?: Awaited<ReturnType<TurnDriver["run"]>>): void;
}

/** A turn driver whose turns wait until a test finishes them; a stopped run ends its turn `stopped`. */
export interface Script {
  readonly driver: TurnDriver;
  readonly turns: readonly Turn[];
  started(count: number): Promise<Turn>;
}

/** Returns a {@link Script} with no turns started. */
export function script(): Script {
  const turns: Turn[] = [];

  return {
    turns,
    driver: {
      run(input) {
        return new Promise((resolve) => {
          turns.push({ input, finish: (end = completed) => resolve(end) });

          if (input.signal.aborted) resolve({ kind: "stopped" });
          input.signal.addEventListener("abort", () => resolve({ kind: "stopped" }), {
            once: true,
          });
        });
      },
    },
    started: (count) => until(() => turns[count - 1]),
  };
}

export async function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeout = 2000,
): Promise<T> {
  const deadline = Date.now() + timeout;

  for (;;) {
    const value = await read();

    if (value !== undefined) return value;

    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition.");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Returns a kernel over `options.store` (default a fresh memory store) with the test workspace added, a connected host over it, and the {@link Script} driving its turns. */
export async function setup(
  options?: Partial<
    Pick<
      Kernel,
      "summarize" | "execution" | "hostId" | "store" | "secrets" | "resolveConfiguration"
    >
  > & {
    readonly script?: Script;
    /** Plugins every session loads after the test environment, for the tools and hooks a test needs. */
    readonly plugins?: readonly Plugin<"core">[];
    readonly poll?: number;
    /** The snapshots the workspace's environment takes; default none. */
    readonly snapshots?: SnapshotsApi;
  },
): Promise<{
  readonly kernel: Kernel;
  readonly host: Omit<Host, "listen">;
  readonly script: Script;
}> {
  const turns = options?.script ?? script();
  const store: StoreConnection = options?.store ?? (await memoryStore().open());

  const kernel = createKernel({
    hostId: options?.hostId ?? asId("h1"),
    store,
    description: { name: "studio", platform: "darwin", version: "0.1.0" },
    host: createHostState({
      catalog: asId("g1"),
      plugins: [],
      settings: [],
      defaultWorkspace: workspace,
    }),
    turn: turns.driver,
    resolveConfiguration: options?.resolveConfiguration ?? (async () => configuration),
    summarize: options?.summarize ?? (async () => ({ kind: "ok", markdown: "Summary.", usage })),
    execution: options?.execution,
    secrets: options?.secrets,
    builtins: [
      { id: "test-environment", environment: provider(options?.snapshots) },
      ...(options?.plugins ?? []),
    ],
    poll: options?.poll,
  });

  if ((await store.refs.get(workspaceRef(workspace))) === null) {
    const record: WorkspaceRecord = {
      id: workspace,
      target: { kind: "test", locator: null },
      identity: asId("identity"),
      projectResources: true,
      projectSources: [],
      addedBy: asId("local"),
      createdAt: 0,
    };

    await store.refs.set([
      {
        name: workspaceRef(workspace),
        target: await store.objects.put(envelope("workspace", record, 0)),
      },
    ]);
  }

  return {
    kernel,
    host: createHost(kernel, { credential: { kind: "token", token: "x" } }),
    script: turns,
  };
}

/** The test workspace's environment: `env`, serving no files; given snapshots, an empty folder that takes them. */
function provider(snapshots: SnapshotsApi | undefined): EnvironmentProvider {
  const base: EnvironmentProvider = {
    kind: "test",
    inspect: async () => ({
      identity: env.identity,
      availability: { kind: "available" },
      projectSources: [],
    }),
    attach: async () => env,
  };

  if (snapshots === undefined) return base;

  const folder: ExecutionEnv = {
    ...env,
    files: {
      ...env.files,
      read: async (path) => ({ kind: "missing", path }),
      async *scan() {
        yield { kind: "complete" };
      },
    },
  };

  return { ...base, attach: async () => folder, snapshots: () => snapshots };
}

export async function startRun(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  origin: RunView["origin"],
  runConfiguration: Configuration,
): Promise<RunView> {
  const started = await newRun(kernel.store, session, head, origin, runConfiguration);
  const outcome = await kernel.store.refs.set(started.updates);

  if (outcome.kind !== "set") throw new Error(`Run ${started.view.id} already exists.`);
  await publishSet(kernel, started.updates, outcome);
  begin(kernel, session, started.view);

  return started.view;
}

export async function expireLease(
  store: StoreConnection,
  session: SessionId,
  head: HeadName,
): Promise<void> {
  await store.refs.set([
    {
      name: leaseRef(session, head),
      target: await store.objects.put(
        envelope("lease", { holder: "crashed", instance: "crashed", expiresAt: 0 }, 0),
      ),
    },
  ]);
}

export async function livePart(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  part: PartId,
  markdown: string,
): Promise<void> {
  const record: PartRecord = {
    id: part,
    partKind: "text",
    placement: { kind: "transcript", role: "answer" },
    state: { markdown, signature: null },
    version: 1,
    owner: null,
    run,
    status: { kind: "live", run },
  };

  const updates: readonly RefUpdate[] = [
    {
      name: partRef(session, part),
      target: await kernel.store.objects.put(envelope("part", record, Date.now())),
      events: [
        {
          head: main,
          kind: "part",
          part,
          change: "created",
          partKind: "text",
          placement: record.placement,
          state: record.state,
          version: 1,
          run,
          owner: null,
        },
      ],
    },
  ];

  await publishSet(kernel, updates, await kernel.store.refs.set(updates));
}

export function label(event: DurableEvent): string {
  if (event.kind === "head") return `head:${event.reason}`;

  return "change" in event ? `${event.kind}:${event.change}` : event.kind;
}

export function recording(store: StoreConnection) {
  const sets: (readonly string[])[] = [];

  return {
    sets,
    store: {
      ...store,
      refs: {
        ...store.refs,
        set(updates) {
          sets.push(updates.flatMap((update) => (update.events ?? []).map(label)));

          return store.refs.set(updates);
        },
      },
    } satisfies StoreConnection,
  };
}

async function refuse(): Promise<never> {
  throw new Error("No environment in tests.");
}

function refuseStream(): AsyncIterable<never> {
  return { [Symbol.asyncIterator]: () => ({ next: refuse }) };
}
