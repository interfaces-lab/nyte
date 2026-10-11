import { asId } from "@nyte-ai/schema";
import type {
  Configuration,
  DurableEvent,
  HeadName,
  PartId,
  RefUpdate,
  RunEnd,
  RunId,
  SessionId,
  Usage,
  WorkspaceId,
} from "@nyte-ai/schema";
import {
  createHost,
  createHostState,
  createKernel,
  envelope,
  leaseRef,
  memoryStore,
  partRef,
  publishSet,
  workspaceRef,
} from "../src/index.ts";
import type {
  ExecutionEnv,
  Host,
  Kernel,
  PartRecord,
  StoreConnection,
  TurnDriver,
  WorkspaceRecord,
} from "../src/index.ts";

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

/** An environment whose files and processes refuse: enough for tools that never touch them. */
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

/** One call the scripted turn received, and how to end it. */
export interface Turn {
  readonly input: Parameters<TurnDriver["run"]>[0];
  finish(end?: RunEnd): void;
}

/** A turn driver that records each call and ends it when the test says, or when its run is stopped. */
export interface Script {
  readonly driver: TurnDriver;
  readonly turns: readonly Turn[];
  /** Resolves with the `count`-th turn once it has started. */
  started(count: number): Promise<Turn>;
}

/** Returns a scripted turn that ends when the test finishes it or its run's signal aborts. */
export function script(): Script {
  const turns: Turn[] = [];

  return {
    turns,
    driver: {
      run(input) {
        return new Promise<RunEnd>((resolve) => {
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

/** Resolves with the first defined value `read` returns, polling; rejects after `timeout` ms. */
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

/** Returns a kernel over a memory store with a registered workspace, scripted slots, and the in-process host over it. */
export async function setup(
  options?: Partial<
    Pick<
      Kernel,
      | "summarize"
      | "execution"
      | "admit"
      | "hostId"
      | "store"
      | "tools"
      | "beforeTool"
      | "afterTool"
      | "snapshots"
      | "secrets"
      | "resolveConfiguration"
    >
  > & {
    readonly script?: Script;
    readonly poll?: number;
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
    host: createHostState({ catalog: asId("g1"), plugins: [], settings: [], operations: [] }),
    defaultWorkspace: workspace,
    turn: turns.driver,
    resolveConfiguration: options?.resolveConfiguration ?? (async () => configuration),
    summarize: options?.summarize ?? (async () => ({ kind: "ok", markdown: "Summary.", usage })),
    execution: options?.execution,
    admit: options?.admit,
    tools: options?.tools,
    beforeTool: options?.beforeTool,
    afterTool: options?.afterTool,
    snapshots: options?.snapshots,
    secrets: options?.secrets,
    env: async () => env,
    poll: options?.poll,
  });

  if ((await store.refs.get(workspaceRef(workspace))) === null) {
    const record: WorkspaceRecord = {
      id: workspace,
      target: { kind: "local", path: "/tmp/project" },
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

/** Writes an expired lease over a head, as a crashed host leaves it once its 30 s have passed (§42j), so a restarted kernel may take the head. */
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

/** Writes a live transcript part for a run, as the turn would. */
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
      event: {
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
    },
  ];

  await publishSet(kernel, updates, await kernel.store.refs.set(updates));
}

/** Names a durable event by kind and change, or reason for a head move: `run:stopping`, `head:moved`. */
export function label(event: DurableEvent): string {
  if (event.kind === "head") return `head:${event.reason}`;

  return "change" in event ? `${event.kind}:${event.change}` : event.kind;
}

/** Returns a store connection that records the event labels of each `refs.set` batch, in order. */
export function recording(store: StoreConnection) {
  const sets: (readonly string[])[] = [];

  return {
    sets,
    store: {
      ...store,
      refs: {
        ...store.refs,
        set(updates) {
          sets.push(updates.flatMap((update) => (update.event ? [label(update.event)] : [])));

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
