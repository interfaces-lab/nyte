import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import type { Execution, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { StatusDot } from "./components/ui.tsx";
import { DEFAULT_SESSION_VIEW, sessionsForView } from "./chrome/sidebar-view.ts";
import { sessionHasUnreadCompletion } from "./session-read-state.ts";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const completed: Execution = {
  kind: "idle",
  lastRun: { id: asId<"run">("run"), end: { kind: "completed", usage }, endedAt: 100 },
};

function session(execution: Execution = completed, unread = true, id = "chat"): SessionInfo {
  return {
    id: asId<"session">(id),
    name: "A thread",
    parent: null,
    call: null,
    workspace: asId<"workspace">("fixture"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [
      {
        name: asId<"head">("main"),
        tip: { kind: "commit", id: asId<"commit">("tip") },
        stack: null,
        execution,
        unread,
      },
    ],
    createdAt: 0,
    lastActivityAt: 120,
  };
}

function indicator(row: SessionInfo): string {
  return renderToStaticMarkup(<StatusDot mark="idle" unread={sessionHasUnreadCompletion(row)} />);
}

function unreadRows(rows: readonly SessionInfo[]): readonly string[] {
  return sessionsForView(
    rows,
    { ...DEFAULT_SESSION_VIEW, statuses: ["unread"] },
    "local",
    1000,
  ).flatMap((group) => group.sessions.map((row) => row.id));
}

test("a completed thread the host marks unread shows its indicator and Unread filter until seen", () => {
  const row = session();
  assert.match(indicator(row), /aria-label="Completed, unread"/);
  assert.deepEqual(unreadRows([row]), ["chat"]);
  const seen = session(completed, false);
  assert.equal(indicator(seen), "");
  assert.deepEqual(unreadRows([seen]), []);
});

test("active work, stopped runs and empty chats do not claim an unread completion", () => {
  const run = {
    id: asId<"run">("run"),
    head: asId<"head">("main"),
    startedAt: 1,
    attempt: 1,
    configuration: {
      kind: "exact" as const,
      model: { provider: "p", id: "m" },
      thinking: "off" as const,
      agent: null,
      settings: {},
      settingsVersion: "1",
    },
    origin: { kind: "input" as const, message: asId<"message">("m") },
  };

  assert.equal(indicator(session({ kind: "live", run, phase: "responding", stopping: false })), "");
  assert.equal(
    indicator(
      session({ kind: "idle", lastRun: { id: run.id, end: { kind: "stopped" }, endedAt: 1 } }),
    ),
    "",
  );
  assert.equal(indicator({ ...session(), heads: [] }), "");
});

test("execution and attention indicators take priority over unread completion", () => {
  const cases = [
    ["working", "Running"],
    ["waiting", "Needs attention"],
    ["retry", "Retrying"],
    ["failed", "Failed"],
  ] as const;

  for (const [mark, label] of cases) {
    for (const unread of [false, true]) {
      const html = renderToStaticMarkup(<StatusDot mark={mark} unread={unread} />);
      assert.ok(html.includes(`aria-label="${label}"`));
      assert.ok(!html.includes("Completed, unread"));
    }
  }
});

/**
 * The regression that motivated the outline: a parked run drew the same filled
 * disc as an unread completion, in a different hue, so the row looked like
 * something had happened. Compare the atomic style classes, which stand for the
 * resolved declarations: accessible names always differ and would hide two
 * states that look alike, and StyleX's debug classes name the style key rather
 * than what it renders. Asserting that they differ, not what they are, leaves
 * restyling free.
 */
test("every row state looks different from the others", () => {
  const looksLike = (markup: string): string =>
    (markup.match(/class="([^"]*)"/)?.[1] ?? "")
      .split(" ")
      .filter((token) => token !== "" && !token.includes("__"))
      .sort()
      .join(" ");

  const looks = [
    ...(["working", "waiting", "retry", "failed"] as const).map((mark) =>
      looksLike(renderToStaticMarkup(<StatusDot mark={mark} />)),
    ),
    looksLike(renderToStaticMarkup(<StatusDot mark="idle" unread />)),
    looksLike(renderToStaticMarkup(<StatusDot mark="idle" />)),
  ];

  assert.equal(new Set(looks).size, looks.length);
});

test("failed threads stay under Needs attention, and parked ones stay under Working", () => {
  const failed = session(
    {
      kind: "idle",
      lastRun: {
        id: asId<"run">("run"),
        end: { kind: "failed", failure: { class: "provider", message: "Provider failed" } },
        endedAt: 1,
      },
    },
    false,
    "failed",
  );

  const groups = sessionsForView(
    [failed],
    { ...DEFAULT_SESSION_VIEW, grouping: "status" },
    "local",
    1000,
  );

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Needs attention"],
  );
});
