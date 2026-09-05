import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { emptyUsageSummary, MAIN } from "@uji-ai/core";
import type { AccountLimits } from "@uji-ai/ai";
import type { Usage } from "@uji-ai/schema";
import {
  collectWorkspaceUsage,
  projectHeadroom,
  usageCard,
  type WorkspaceUsage,
} from "../src/usage.ts";
import { SqliteSessionRepo, type SessionStorage } from "@uji-ai/core/store";

/** The fenced writer a won claim hands back; the main entry does not name it. */
type RunWriter = Extract<Awaited<ReturnType<SessionStorage["claimRun"]>>, { ok: true }>["writer"];

const NOW = 2_000_000_000_000;
const MINUTE = 60_000;
const directories: string[] = [];
const repos: SqliteSessionRepo[] = [];

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => repo.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function openRepo(): Promise<SqliteSessionRepo> {
  const directory = await mkdtemp(join(tmpdir(), "uji-usage-"));
  directories.push(directory);
  const repo = new SqliteSessionRepo(join(directory, "sessions.db"));
  repos.push(repo);
  return repo;
}

function usageOf(input: number, output: number, cost: number): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

/** Claim `main`, write the run's opening record, and hand the fenced writer back. */
async function startRun(session: SessionStorage, runId: string): Promise<RunWriter> {
  const claimed = await session.claimRun(MAIN, runId);
  if (!claimed.ok) assert.fail(`claim on ${runId} was held`);
  await claimed.writer.appendRecord({
    type: "operation_started",
    id: runId,
    head: MAIN,
    sourceLeafId: null,
    intent: { kind: "run", originalPrompt: [], initialMessages: [] },
  });
  return claimed.writer;
}

async function recordUsage(
  writer: RunWriter,
  runId: string,
  id: string,
  cause: "assistant" | "tool",
  usage: Usage,
): Promise<void> {
  await writer.appendRecord({ type: "usage", id, head: MAIN, runId, cause, usage });
}

function emptyWorkspace(): WorkspaceUsage {
  return { runs: [], chats: 0, workspace: emptyUsageSummary(), current: emptyUsageSummary() };
}

function limits(
  providerId: string,
  usedPercent: number,
  options: { observedAt?: number; plan?: string } = {},
): AccountLimits {
  return {
    providerId,
    ...(options.plan === undefined ? {} : { plan: options.plan }),
    windows: [{ id: "five_hour", usedPercent, resetsAt: NOW + 60 * MINUTE, windowMinutes: 300 }],
    observedAt: options.observedAt ?? NOW,
  };
}

void describe("collectWorkspaceUsage", () => {
  void test("sums a live run's committed records and leaves the workspace total to the entries", async () => {
    const repo = await openRepo();
    const session = await repo.create();
    const { id } = await session.getMetadata();
    const writer = await startRun(session, "run-1");
    const turn = usageOf(100, 20, 0.5);
    const tool = usageOf(30, 0, 0.1);
    try {
      await writer.appendEntry({
        type: "message",
        id: "assistant-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "gpt-x",
          usage: turn,
          stopReason: "stop",
          timestamp: NOW,
        },
      });
      await recordUsage(writer, "run-1", "usage-1", "assistant", turn);
      await recordUsage(writer, "run-1", "usage-2", "tool", tool);

      const report = await collectWorkspaceUsage(repo, id);
      const [run, ...others] = report.runs;
      assert.ok(run);
      assert.deepEqual(others, []);
      assert.equal(run.current, true);
      assert.equal(run.state, "live");
      assert.equal(run.operation, "run");
      assert.equal(run.usage.totalTokens, turn.totalTokens + tool.totalTokens);
      assert.equal(run.usage.cost.total, turn.cost.total + tool.cost.total);
      // The tool record has no entry yet, so the durable total is the one assistant turn.
      assert.equal(report.chats, 1);
      assert.equal(report.workspace.total.totalTokens, turn.totalTokens);
      assert.equal(report.current.total.totalTokens, turn.totalTokens);
    } finally {
      await writer.release();
      await session.close();
    }
  });

  void test("an open operation nobody claims is interrupted; a finished one is gone", async () => {
    const repo = await openRepo();
    const current = await repo.create();
    const other = await repo.create();
    const { id: currentId } = await current.getMetadata();
    const { id: otherId } = await other.getMetadata();
    try {
      await other.setName("explore notes");
      const abandoned = await startRun(other, "run-lost");
      await abandoned.release();

      const done = await startRun(current, "run-done");
      await done.finish({
        type: "operation_finished",
        id: "finish-1",
        head: MAIN,
        runId: "run-done",
        outcome: "completed",
      });

      const report = await collectWorkspaceUsage(repo, currentId);
      assert.deepEqual(
        report.runs.map((run) => [run.sessionId, run.label, run.current, run.state]),
        [[otherId, "explore notes", false, "interrupted"]],
      );

      const card = usageCard(report, [], { activeProvider: "openai", refreshing: false, now: NOW });
      assert.equal(card.runs.kind, "runs");
      assert.equal(card.runs.summary, "1 interrupted");
      assert.equal(card.runs.rows[0].label, "explore notes");
      assert.equal(card.runs.rows[0].detail, "interrupted");
    } finally {
      await current.close();
      await other.close();
    }
  });
});

void describe("projectHeadroom", () => {
  void test("keeps a supported provider without data unknown and skips unsupported ones", () => {
    assert.deepEqual(projectHeadroom([], "anthropic"), [
      { kind: "unknown", provider: "anthropic", name: "Claude", source: "fetched" },
    ]);
    assert.deepEqual(projectHeadroom([], "openai"), []);
  });

  void test("lists the active provider first, then whatever the host has cached", () => {
    const rows = projectHeadroom([limits("openai-codex", 28, { plan: "plus" })], "anthropic");
    assert.deepEqual(
      rows.map((row) => [row.provider, row.kind]),
      [
        ["anthropic", "unknown"],
        ["openai-codex", "known"],
      ],
    );
    const codex = rows[1];
    assert.ok(codex?.kind === "known");
    assert.equal(codex.plan, "plus");
    assert.deepEqual(codex.windows[0], {
      label: "5h",
      remainingPercent: 72,
      resetsAt: NOW + 60 * MINUTE,
    });
  });
});

void describe("usageCard", () => {
  void test("shows a stale value with its age and tones low headroom", () => {
    const card = usageCard(
      emptyWorkspace(),
      [limits("openai-codex", 96, { observedAt: NOW - 20 * MINUTE }), limits("anthropic", 88)],
      { activeProvider: "openai-codex", refreshing: false, now: NOW },
    );
    assert.equal(card.headroom.kind, "providers");
    assert.equal(card.headroom.summary, "2 providers · 1 stale");
    const [codex, claude] = card.headroom.rows;
    assert.ok(codex.kind === "known");
    assert.equal(codex.stale, true);
    assert.equal(codex.meta, "fetched 20m ago");
    assert.equal(codex.windows[0].tone, "critical");
    assert.equal(codex.windows[0].remaining.trim(), "4%");
    assert.equal(codex.windows[0].share, 0.04);
    assert.ok(claude?.kind === "known");
    assert.equal(claude.stale, false);
    assert.equal(claude.windows[0].tone, "warning");
  });

  void test("a refresh in flight updates fetchable provider copy", () => {
    const cached = [
      limits("openai-codex", 24, { observedAt: NOW - 18 * MINUTE }),
      limits("anthropic", 19),
    ];
    const before = usageCard(emptyWorkspace(), cached, {
      activeProvider: "openai-codex",
      refreshing: true,
      now: NOW,
    });
    const after = usageCard(emptyWorkspace(), cached, {
      activeProvider: "openai-codex",
      refreshing: false,
      now: NOW,
    });
    assert.ok(before.headroom.kind === "providers" && after.headroom.kind === "providers");
    assert.equal(before.headroom.rows[0].meta, "checking · 18m old");
    assert.equal(after.headroom.rows[0].meta, "fetched 18m ago");
    assert.ok(before.headroom.rows[1]?.kind === "known");
    assert.ok(after.headroom.rows[1]?.kind === "known");
    assert.equal(before.headroom.rows[1].meta, "fetched now");
    assert.deepEqual(before.headroom.rows[1], after.headroom.rows[1]);

    const unknown = usageCard(emptyWorkspace(), [], {
      activeProvider: "openai-codex",
      refreshing: true,
      now: NOW,
    });
    assert.ok(unknown.headroom.kind === "providers");
    assert.deepEqual(unknown.headroom.rows[0], {
      kind: "unknown",
      name: "OpenAI Codex",
      meta: "checking…",
    });

    const unknownClaude = usageCard(emptyWorkspace(), [], {
      activeProvider: "anthropic",
      refreshing: true,
      now: NOW,
    });
    assert.ok(unknownClaude.headroom.kind === "providers");
    assert.deepEqual(unknownClaude.headroom.rows[0], {
      kind: "unknown",
      name: "Claude",
      meta: "checking…",
    });
  });

  void test("an API-key provider gets the empty headroom state, not a failure", () => {
    const card = usageCard(emptyWorkspace(), [], {
      activeProvider: "openai",
      refreshing: false,
      now: NOW,
    });
    assert.deepEqual(card.headroom, { kind: "none" });
    assert.deepEqual(card.runs, { kind: "none" });
    assert.deepEqual(card.workspace, {
      kind: "empty",
      title: "workspace",
      message: "No usage recorded",
    });
  });

  void test("in-progress rows carry committed usage and say so, never an estimate", () => {
    const card = usageCard(
      {
        ...emptyWorkspace(),
        runs: [
          {
            sessionId: "s1",
            label: "s1",
            current: true,
            operation: "compaction",
            state: "live",
            startedAt: NOW - 2 * MINUTE,
            usage: usageOf(30_000, 2_400, 0.06),
          },
        ],
      },
      [],
      { activeProvider: "openai", refreshing: false, now: NOW },
    );
    assert.equal(card.runs.kind, "runs");
    assert.equal(card.runs.summary, "1 running");
    assert.deepEqual(card.runs.rows[0], {
      state: "live",
      label: "this chat",
      detail: "compaction · 2m0s",
      usage: "32.4k · $0.06",
    });
    assert.match(card.runs.note, /committed/);
    assert.doesNotMatch(JSON.stringify(card), /~/);
  });

  void test("workspace bars follow cost, or tokens when nothing cost anything", () => {
    const paid = usageCard(
      {
        ...emptyWorkspace(),
        chats: 2,
        workspace: {
          models: [
            { model: "big", turns: 3, usage: usageOf(1_000_000, 300_000, 12.35) },
            { model: "mini", turns: 9, usage: usageOf(900_000, 100_000, 0.005) },
          ],
          compaction: usageOf(0, 0, 0),
          tools: usageOf(0, 0, 0),
          total: usageOf(1_900_000, 400_000, 12.355),
        },
        current: {
          models: [{ model: "mini", turns: 1, usage: usageOf(30_000, 2_400, 0.06) }],
          compaction: usageOf(0, 0, 0),
          tools: usageOf(0, 0, 0),
          total: usageOf(30_000, 2_400, 0.06),
        },
      },
      [],
      { activeProvider: "openai", refreshing: false, now: NOW },
    );
    assert.ok(paid.workspace.kind === "usage");
    assert.equal(paid.workspace.title, "workspace · 2 chats");
    assert.deepEqual(
      paid.workspace.rows.map((row) => [row.label, row.share, row.cost, row.tokens]),
      [
        ["big", 1, " $12.35", "1.3m"],
        ["mini", 0.005 / 12.35, "$0.0050", "1.0m"],
      ],
    );
    assert.equal(paid.workspace.thisChat, "this chat · 32.4k tokens · $0.06");

    const free = usageCard(
      {
        ...emptyWorkspace(),
        chats: 1,
        workspace: {
          models: [
            { model: "a", turns: 1, usage: usageOf(400, 0, 0) },
            { model: "b", turns: 1, usage: usageOf(100, 0, 0) },
          ],
          compaction: usageOf(0, 0, 0),
          tools: usageOf(0, 0, 0),
          total: usageOf(500, 0, 0),
        },
      },
      [],
      { activeProvider: "openai", refreshing: false, now: NOW },
    );
    assert.ok(free.workspace.kind === "usage");
    assert.deepEqual(
      free.workspace.rows.map((row) => row.share),
      [1, 0.25],
    );
  });
});
