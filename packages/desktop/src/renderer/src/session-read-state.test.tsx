import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionInfo } from "@nyte-ai/protocol";
import { StatusDot } from "./components/ui.tsx";
import { DEFAULT_SESSION_VIEW, sessionsForView } from "./chrome/sidebar-view.ts";
import { SessionReadState, sessionHasUnreadCompletion } from "./session-read-state.ts";

function session(
  phase: NonNullable<SessionInfo["heads"][number]["run"]>["phase"] = { kind: "done" },
  startedAt = 100,
): SessionInfo {
  return {
    sessionId: sessionId("chat"),
    activation: { kind: "active" },
    name: "A thread",
    createdAt: 0,
    lastActivityAt: startedAt + 20,
    pinned: false,
    archived: false,
    config: {},
    heads: [
      {
        head: "main",
        tip: null,
        run: {
          runId: `run-${startedAt}`,
          head: "main",
          origin: { kind: "user" },
          root: `run-${startedAt}`,
          phase,
          startedAt,
          attempts: 1,
          config: {},
        },
      },
    ],
  };
}

function indicator(row: SessionInfo, state: SessionReadState): string {
  return renderToStaticMarkup(
    <StatusDot mark="idle" unread={sessionHasUnreadCompletion(row, state.getSnapshot())} />,
  );
}

function unreadRows(rows: readonly SessionInfo[], state: SessionReadState): readonly string[] {
  return sessionsForView(
    rows,
    { ...DEFAULT_SESSION_VIEW, statuses: ["unread"] },
    "local",
    1000,
    state.getSnapshot(),
  ).flatMap((group) => group.sessions.map((row) => row.sessionId));
}

test("opening a completed thread clears its indicator and Unread filter, including after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "nyte-read-sessions-"));
  const path = join(directory, "local-storage.json");
  writeFileSync(path, "null");
  const storage = {
    getItem: () => readFileSync(path, "utf8"),
    setItem: (_key: string, value: string) => writeFileSync(path, value),
  };
  try {
    const state = new SessionReadState(storage);
    const row = session();
    assert.match(indicator(row, state), /aria-label="Completed, unread"/);
    assert.deepEqual(unreadRows([row], state), ["chat"]);
    state.markRead(row);
    assert.equal(indicator(row, state), "");
    assert.deepEqual(unreadRows([row], state), []);
    assert.equal(indicator(row, new SessionReadState(storage)), "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a later completion becomes unread, but renaming, pinning, and stale polls do not", () => {
  const state = new SessionReadState();
  const first = session();
  state.markRead(first);
  assert.equal(
    indicator({ ...first, name: "Renamed", pinned: true, lastActivityAt: 900 }, state),
    "",
  );
  const second = session({ kind: "done" }, 200);
  assert.match(indicator(second, state), /Completed, unread/);
  state.markRead(second);
  state.markRead(first);
  assert.equal(indicator(second, state), "");
  assert.equal(indicator(first, state), "");
});

test("opening active work does not mark its future completion read", () => {
  const state = new SessionReadState();
  const row = session({ kind: "tools" });
  state.markRead(row);
  assert.deepEqual(unreadRows([row], state), []);
  assert.match(indicator(session(), state), /Completed, unread/);
  state.markRead(session());
  assert.equal(indicator(session(), state), "");
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

test("aborted runs and empty chats do not claim an unread completion", () => {
  const state = new SessionReadState();
  assert.equal(indicator(session({ kind: "aborted" }), state), "");
  assert.equal(indicator({ ...session(), heads: [{ head: "main", tip: null }] }, state), "");
});

test("read receipts are independent for sessions and heads", () => {
  const state = new SessionReadState();
  const first = session();
  const otherSession = { ...first, sessionId: sessionId("other") };
  const branch = {
    ...first,
    heads: first.heads.map((head) => ({ ...head, head: "branch" })),
  };
  state.markRead(first);
  assert.match(indicator(otherSession, state), /Completed, unread/);
  assert.match(indicator(branch, state), /Completed, unread/);
  state.markRead(branch);
  assert.equal(indicator({ ...first, heads: [...first.heads, ...branch.heads] }, state), "");
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

test("failed threads stay under Needs attention after opening, and parked ones stay under Working", () => {
  const state = new SessionReadState();
  const failed = session({
    kind: "failed",
    failure: { class: "provider", message: "Provider failed" },
  });
  const parked = { ...session({ kind: "waiting" }), sessionId: sessionId("parked") };
  state.markRead(failed);
  state.markRead(parked);
  const groups = sessionsForView(
    [failed, parked],
    { ...DEFAULT_SESSION_VIEW, grouping: "status" },
    "local",
    1000,
    state.getSnapshot(),
  );
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Needs attention", "Working"],
  );
});

test("invalid or unavailable storage still allows a thread to be marked read", () => {
  for (const raw of ["{", "null", "[]", '{"chat":{"runId":2,"startedAt":"bad"}}']) {
    const state = new SessionReadState({
      getItem: () => raw,
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    const row = session();
    assert.match(indicator(row, state), /Completed, unread/);
    state.markRead(row);
    assert.equal(indicator(row, state), "");
  }
});
