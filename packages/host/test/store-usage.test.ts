import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { envelope } from "@nyte-ai/core/store";
import { asId } from "@nyte-ai/schema";
import type { DurableEvent, Usage } from "@nyte-ai/schema";
import { sqliteStore } from "../src/sqlite.ts";
import {
  USAGE_EVENTS,
  localDay,
  projectUsageReport,
  readNyteUsage,
  shiftDay,
} from "../src/store-usage.ts";

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "nyte-usage-"));
  folders.push(home);
  await mkdir(join(home, ".nyte"));

  return home;
}

const at = new Date(2026, 8, 2, 23, 30).getTime();

const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 2,
  cacheWrite: 3,
  reasoning: 2,
  total: 20,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
};

const sessionId = asId<"session">("session");

const head = asId<"head">("main");

const configuration = {
  kind: "exact",
  settings: {},
  settingsVersion: "test",
  model: { provider: "test", id: "model" },
  thinking: "off",
  agent: null,
} as const;

test("reads charged requests once, with workspace and session metadata, not run totals or receipts", async () => {
  const home = await fixture();
  const store = sqliteStore({ path: join(home, ".nyte", "nyte.db") });

  try {
    const connection = await store.open();

    const workspace = await connection.objects.put(
      envelope(
        "workspace",
        {
          id: "workspace",
          target: { kind: "local", path: "/project" },
          identity: "local",
          projectSources: [],
          addedBy: "local",
          createdAt: at,
          isolation: null,
        },
        at,
      ),
    );

    const session = await connection.objects.put(
      envelope(
        "session",
        {
          id: sessionId,
          name: "Ship it",
          parent: null,
          origin: null,
          prompt: null,
          workspace: "workspace",
          pinned: false,
          archived: false,
          createdAt: at,
          lastActivityAt: at + 99,
          heads: [],
        },
        at,
      ),
    );

    await connection.refs.set([
      { name: "workspaces/workspace", target: workspace },
      { name: "sessions/session", target: session },
    ]);

    const events: readonly DurableEvent[] = [
      {
        head,
        kind: "run",
        run: asId("run"),
        change: "started",
        view: {
          id: asId("run"),
          head,
          startedAt: at,
          attempt: 0,
          configuration,
          origin: { kind: "continuation", from: "wake" },
        },
      },
      ...(["assistant", "assistant", "compaction", "summary", "plugin"] as const).map(
        (step) =>
          ({
            head,
            kind: "request",
            step,
            usage,
            context: { tokens: 20, window: 1000, lastRequest: usage },
          }) satisfies DurableEvent,
      ),
      { head, kind: "run", run: asId("run"), change: "ended", end: { kind: "completed", usage } },
    ];

    await connection.refs.set(
      events.map((event) => ({ name: "sessions/session", target: session, events: [event] })),
    );
    const report = readNyteUsage(home, { sinceDay: null, untilDay: localDay(Date.now()) });
    expect(report.sources).toEqual([
      { workspacePath: "/project", status: "ok", sessions: 1, message: null },
    ]);
    expect(
      report.entries.map((entry) => [entry.subject.kind, entry.totals.tokens, entry.totals.cost]),
    ).toEqual([
      ["model", 40, 6],
      ["compaction", 40, 6],
      ["tool", 20, 3],
    ]);
    expect(report.entries[0]?.subject).toEqual({ kind: "model", provider: "test", model: "model" });
    expect(report.sessions).toEqual([
      { sessionId, name: "Ship it", workspacePath: "/project", lastActivityAt: at + 99 },
    ]);
    expect(report.earliestDay).toBe(localDay(Date.now()));
    expect(report.readAt).toBeGreaterThanOrEqual(at);
  } finally {
    await store.close();
  }
});

test("projects local calendar days, inclusive windows and prior totals without counting reasoning twice", () => {
  const day = localDay(at);

  const report = projectUsageReport(
    [
      {
        workspacePath: null,
        failure: null,
        sessions: [
          {
            sessionId,
            name: undefined,
            records: [
              { at, subject: { kind: "tool" }, usage },
              {
                at: new Date(2026, 8, 1, 23, 30).getTime(),
                subject: { kind: "compaction" },
                usage,
              },
              {
                at,
                subject: { kind: "tool" },
                usage: {
                  ...usage,
                  total: 0,
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  cost: { ...usage.cost, total: 0 },
                },
              },
            ],
          },
        ],
      },
    ],
    { sinceDay: day, untilDay: day },
    at,
  );

  expect(day).toBe("2026-09-02");
  expect(report.entries).toHaveLength(1);
  expect(report.entries[0]?.totals).toMatchObject({ tokens: 20, reasoning: 2 });
  expect(report.previous).toEqual({ cost: 3, tokens: 20 });
  expect(report.earliestDay).toBe(shiftDay(day, -1));
});

test("absent databases stay absent and corrupt databases produce a failed source", async () => {
  const home = await fixture();
  const window = { sinceDay: null, untilDay: "2026-09-02" };
  expect(readNyteUsage(home, window).sources).toEqual([]);
  await writeFile(join(home, ".nyte", "nyte.db"), "not sqlite");
  expect(readNyteUsage(home, window).sources[0]?.status).toBe("failed");
});

test("a migrated store answers the usage read from the log kind index, not a log scan", async () => {
  const path = join(await fixture(), ".nyte", "nyte.db");
  const store = sqliteStore({ path });
  await store.open();
  await store.close();
  const database = new DatabaseSync(path, { readOnly: true });

  try {
    const plan = database
      .prepare(`EXPLAIN QUERY PLAN ${USAGE_EVENTS}`)
      .all()
      .map((row) => String(row.detail));

    expect(plan.filter((detail) => detail.includes("log"))).toEqual([
      "SEARCH log USING INDEX log_kind (<expr>=?)",
      "SEARCH log USING INDEX log_kind (<expr>=?)",
    ]);
  } finally {
    database.close();
  }
});
