/**
 * Shared fixtures for the kernel suites: a real SQLite store on a temp file,
 * schema message builders, and commit chains written the way a
 * runner writes them. Nothing here is a mock; every test drives the store the
 * kernel drives.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { TreeId } from "@nyte-ai/protocol";
import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@nyte-ai/schema";
import type {
  Commit,
  CommitBody,
  Event,
  Failure,
  Lease,
  LeaseOutcome,
  Oid,
  ToolClass,
} from "../../src/kernel/model.ts";
import { headRef } from "../../src/kernel/names.ts";
import { SqliteStore } from "../../src/kernel/sqlite.ts";
import { WorkerStore } from "../../src/kernel/worker-store.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import { TRUSTED_WORKSPACE } from "../../src/kernel/sdk/types.ts";
import type { TrustedWorkspace } from "../../src/kernel/sdk/types.ts";

/** What the host's trust store would mint after a grant on `cwd`. */
export async function trustWorkspace(cwd: string): Promise<TrustedWorkspace> {
  return { cwd: await realpath(cwd), [TRUSTED_WORKSPACE]: true };
}

export const drain = "one" as const;

const directories: string[] = [];
const stores: Store[] = [];

afterEach(async () => {
  for (const store of stores.splice(0).reverse()) await store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

export function storePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "nyte-kernel-"));
  directories.push(directory);
  return join(directory, "store.db");
}

/**
 * A store on its own temp file. A second call with the same path is a second
 * connection. `NYTE_TEST_STORE=worker` runs the same suite through the worker
 * bridge, so both backends answer to one set of expectations.
 */
export function openStore(path = storePath()): Store {
  const store =
    process.env.NYTE_TEST_STORE === "worker"
      ? new WorkerStore({
          path,
          worker: new URL("../../src/kernel/store-worker.ts", import.meta.url),
          watchPollIntervalMs: 5,
        })
      : openInProcessStore(path);
  stores.push(store);
  return store;
}

/** The in-process backend regardless of `NYTE_TEST_STORE`, for tests that drive its timers with fake time. */
export function openInProcessStore(path = storePath()): SqliteStore {
  const store = new SqliteStore(path, { watchPollIntervalMs: 5 });
  stores.push(store);
  return store;
}

export async function openSession(id = "s"): Promise<Session> {
  return openStore().create({ id });
}

export const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function user(text: string, at = 1_000): UserMessage {
  return { role: "user", content: text, timestamp: at };
}

export function assistant(
  text: string,
  options: {
    readonly calls?: readonly ToolCall[];
    readonly stop?: AssistantMessage["stopReason"];
    readonly error?: string;
    readonly at?: number;
    readonly usage?: Usage;
  } = {},
): AssistantMessage {
  const calls = options.calls ?? [];
  const message: AssistantMessage = {
    role: "assistant",
    content: [...(text === "" ? [] : [{ type: "text" as const, text }]), ...calls],
    api: "openai-responses",
    provider: "openai",
    model: "test-model",
    usage: options.usage ?? usage,
    stopReason: options.stop ?? (calls.length > 0 ? "toolUse" : "stop"),
    timestamp: options.at ?? 1_000,
  };
  return options.error === undefined ? message : { ...message, errorMessage: options.error };
}

export function call(id: string, name: string, args: ToolCall["arguments"] = {}): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

export function toolResult(
  callId: string,
  name: string,
  text: string,
  options: {
    readonly isError?: boolean;
    readonly at?: number;
    readonly details?: ToolResultMessage["details"];
  } = {},
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: name,
    content: [{ type: "text", text }],
    details: options.details ?? {},
    isError: options.isError ?? false,
    timestamp: options.at ?? 1_000,
  };
}

export function message(value: UserMessage): Extract<CommitBody, { readonly message: UserMessage }>;
export function message(
  value: AssistantMessage,
): Extract<CommitBody, { readonly message: AssistantMessage }>;
export function message(
  value: ToolResultMessage,
): Extract<CommitBody, { readonly message: ToolResultMessage }>;
export function message(value: Message): CommitBody;
export function message(value: Message): CommitBody {
  switch (value.role) {
    case "user":
      return { kind: "message", message: value };
    case "assistant":
      return { kind: "message", message: value };
    case "toolResult":
      return { kind: "message", message: value };
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

interface CommitFields {
  readonly at?: number;
  readonly run?: string;
  readonly change?: Oid;
}

type UserCommitBody = Extract<Commit, { readonly body: { readonly message: UserMessage } }>["body"];
type AssistantCommitBody = Extract<
  Commit,
  { readonly body: { readonly message: AssistantMessage } }
>["body"];
type ToolResultCommitBody = Extract<
  Commit,
  { readonly body: { readonly message: ToolResultMessage } }
>["body"];

function commitFields(parent: Oid | null, options: CommitFields) {
  return {
    kind: "commit" as const,
    parent,
    at: options.at ?? 1_000,
    ...(options.run === undefined ? {} : { run: options.run }),
    ...(options.change === undefined ? {} : { change: options.change }),
  };
}

export function userCommit(
  parent: Oid | null,
  body: UserCommitBody,
  options: CommitFields & {
    readonly start?: { readonly kind: "run"; readonly tree: TreeId | null };
  } = {},
): Commit {
  return {
    ...commitFields(parent, options),
    body,
    start: options.start ?? { kind: "none" },
  };
}

export function assistantCommit(
  parent: Oid | null,
  body: AssistantCommitBody,
  options: CommitFields & {
    readonly calls?: Readonly<Record<string, ToolClass>>;
    readonly failure?: Failure;
  } = {},
): Commit {
  const calls = Object.fromEntries(
    body.message.content.flatMap((part) =>
      part.type === "toolCall" ? [[part.id, { kind: "custom", label: part.name }] as const] : [],
    ),
  );
  return {
    ...commitFields(parent, options),
    body,
    calls: { ...calls, ...options.calls },
    outcome:
      options.failure === undefined ? { kind: "ok" } : { kind: "failed", failure: options.failure },
  };
}

export function toolResultCommit(
  parent: Oid | null,
  body: ToolResultCommitBody,
  options: CommitFields & { readonly call?: ToolClass; readonly tree?: TreeId } = {},
): Commit {
  return {
    ...commitFields(parent, options),
    body,
    call: options.call ?? { kind: "custom", label: body.message.toolName },
    tree: options.tree ?? null,
  };
}

export function completionCommit(
  parent: Oid | null,
  body: Extract<CommitBody, { readonly kind: "completion" }>,
  options: CommitFields & {
    readonly start?: { readonly kind: "run"; readonly tree: TreeId | null };
  } = {},
): Commit {
  return {
    ...commitFields(parent, options),
    body,
    start: options.start ?? { kind: "none" },
  };
}

export function summaryCommit(
  parent: Oid | null,
  body: Extract<CommitBody, { readonly kind: "summary" }>,
  options: CommitFields & { readonly imports?: readonly Oid[] } = {},
): Commit {
  return { ...commitFields(parent, options), body, imports: options.imports ?? [] };
}

export function commit(parent: Oid | null, body: CommitBody, options: CommitFields = {}): Commit {
  switch (body.kind) {
    case "message":
      switch (body.message.role) {
        case "user":
          return userCommit(
            parent,
            "agent" in body && body.agent !== undefined
              ? { kind: "message", message: body.message, agent: body.agent }
              : { kind: "message", message: body.message },
            options,
          );
        case "assistant":
          return assistantCommit(parent, { kind: "message", message: body.message }, options);
        case "toolResult":
          return toolResultCommit(parent, { kind: "message", message: body.message }, options);
        default: {
          const _exhaustive: never = body.message;
          return _exhaustive;
        }
      }
    case "completion":
      return completionCommit(parent, body, options);
    case "summary":
      return summaryCommit(parent, body, options);
    case "checkpoint":
      return { ...commitFields(parent, options), body };
    case "config":
      return { ...commitFields(parent, options), body };
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
}

/** Write a chain of commits, oldest first, on top of `parent`. Returns the oids oldest first. */
export async function chain(
  session: Session,
  parent: Oid | null,
  bodies: readonly CommitBody[],
  options: { readonly at?: number; readonly run?: string } = {},
): Promise<Oid[]> {
  const oids: Oid[] = [];
  let previous = parent;
  let at = options.at ?? 1_000;
  for (const body of bodies) {
    const [oid] = await session.objects.put([
      commit(previous, body, {
        at,
        ...(options.run === undefined ? {} : { run: options.run }),
      }),
    ]);
    if (oid === undefined) assert.fail("put returned no oid");
    oids.push(oid);
    previous = oid;
    at += 1;
  }
  return oids;
}

/** Point a head at a commit as a participant would, whatever it pointed at before. */
export async function setHead(session: Session, head: string, to: Oid | null): Promise<void> {
  const from = await session.refs.read(headRef(head));
  const outcome = await session.refs.update([{ name: headRef(head), from, to }], {
    reason: "test",
  });
  assert.equal(outcome.ok, true, "setHead must not conflict in a test");
}

/** Write a chain and point the head at its tip. Returns the oids oldest first. */
export async function seedHead(
  session: Session,
  head: string,
  bodies: readonly CommitBody[],
  options: { readonly run?: string } = {},
): Promise<Oid[]> {
  const from = await session.refs.read(headRef(head));
  const oids = await chain(session, from, bodies, options);
  await setHead(session, head, oids.at(-1) ?? from);
  return oids;
}

export function granted(outcome: LeaseOutcome): Lease {
  if (!outcome.ok) assert.fail(`lease held by ${outcome.holder.owner}`);
  return outcome.lease;
}

export async function lease(session: Session, head: string, ttlMs = 30_000): Promise<Lease> {
  return granted(await session.leases.acquire(headRef(head), ttlMs));
}

export function only<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined || items.length !== 1)
    assert.fail(`expected one item, got ${items.length}`);
  return item;
}

export async function within<T>(promise: Promise<T>, timeoutMs = 3_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function nextEvent(iterator: AsyncIterator<Event>): Promise<Event> {
  const result = await within(iterator.next());
  if (result.done) assert.fail("event stream ended early");
  return result.value;
}

/** Ref events as `name:from>to`, the reflog line a reader compares by eye. */
export function reflog(events: readonly Event[]): string[] {
  return events.flatMap((event) =>
    event.kind === "ref"
      ? [`${event.name} ${event.from ?? "-"} > ${event.to ?? "-"} (${event.reason})`]
      : [],
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
