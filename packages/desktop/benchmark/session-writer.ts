import { SqliteStore } from "@nyte-ai/core/store";
import type { Session } from "@nyte-ai/core/store";
import type { Commit, CommitBody } from "@nyte-ai/protocol";
import type { DesktopBenchmarkFixture } from "./fixtures.ts";

type EventBody = Parameters<Session["events"]["append"]>[0][number];

const USAGE = {
  input: 128,
  output: 64,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface BenchmarkSessionWriter {
  readonly sessionId: string;
  appendUser(content: string): Promise<void>;
  appendTextDelta(runId: string, index: number, delta: string): Promise<void>;
  settleAssistant(runId: string, content: string): Promise<void>;
  interruptWatchProjection(): Promise<void>;
  close(): Promise<void>;
}

async function putCommit(
  session: Session,
  parent: string | null,
  body: CommitBody,
  run?: string,
): Promise<string> {
  const base = { kind: "commit", parent, body, at: Date.now() } satisfies Commit;
  const commit = run === undefined ? base : ({ ...base, run } satisfies Commit);
  const [oid] = await session.objects.put([commit]);
  if (oid === undefined) throw new Error("SQLite did not return a commit object id");
  return oid;
}

export async function openBenchmarkSessionWriter(
  fixture: DesktopBenchmarkFixture,
  sessionIndex: number,
): Promise<BenchmarkSessionWriter> {
  const seeded = fixture.sessions[sessionIndex];
  if (seeded === undefined)
    throw new RangeError(`Unknown benchmark session index ${String(sessionIndex)}`);
  const store = new SqliteStore(fixture.paths.workspaceStore);
  const session = await store.open(seeded.id);
  let tip = await session.refs.read("refs/heads/main");
  let closed = false;

  const moveHead = async (next: string, reason: string): Promise<void> => {
    const outcome = await session.refs.update([{ name: "refs/heads/main", from: tip, to: next }], {
      reason,
    });
    if (!outcome.ok) throw new Error(`Benchmark head move failed: ${outcome.reason}`);
    tip = next;
  };

  return {
    sessionId: seeded.id,
    appendUser: async (content) => {
      const body = {
        kind: "message",
        message: { role: "user", content, timestamp: Date.now() },
      } satisfies CommitBody;
      await moveHead(await putCommit(session, tip, body), "benchmark-stream-user");
    },
    appendTextDelta: async (runId, index, delta) => {
      const event = {
        kind: "delta",
        runId,
        attempt: 1,
        index,
        part: "text",
        delta,
      } satisfies EventBody;
      const outcome = await session.events.append([event]);
      if (!outcome.ok) throw new Error("Benchmark delta append was fenced");
    },
    settleAssistant: async (runId, content) => {
      const body = {
        kind: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: content }],
          stopReason: "stop",
          provider: "opencode",
          api: "openai-responses",
          model: fixture.catalog.firstModelId,
          timestamp: Date.now(),
          usage: USAGE,
        },
      } satisfies CommitBody;
      await moveHead(await putCommit(session, tip, body, runId), "benchmark-stream-settle");
    },
    interruptWatchProjection: async () => {
      const [oid] = await session.objects.put([
        { kind: "blob", value: "not a run; benchmark projection interruption" },
      ]);
      if (oid === undefined) throw new Error("SQLite did not return a projection fixture id");
      const event = {
        kind: "ref",
        name: "refs/runs/main",
        from: null,
        to: oid,
        reason: "benchmark-projection-interruption",
      } satisfies EventBody;
      const outcome = await session.events.append([event]);
      if (!outcome.ok) throw new Error("Benchmark projection interruption was fenced");
    },
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await session.close();
      } finally {
        await store.close();
      }
    },
  };
}
