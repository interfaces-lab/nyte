import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { Execution, SessionInfo } from "@nyte-ai/sdk";
import { chatsFor, COMPLETED, sessionRow } from "../../test/view-fixtures.ts";
import { chatMark, sessionsForView } from "../sidebar/sidebar-view.ts";
import { DEFAULT_SESSION_VIEW } from "../preferences/session-view.ts";
import { StatusGlyph } from "./status-glyph.tsx";

const run = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 1,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("m") },
} as const;

const LIVE: Execution = { kind: "live", run, phase: "responding", stopping: false };

const FAILED: Execution = {
  kind: "idle",
  lastRun: {
    id: run.id,
    end: { kind: "failed", failure: { class: "provider", message: "Provider failed" } },
    endedAt: 1,
  },
};

function unread(id: string, execution: Execution, change: Partial<SessionInfo> = {}): SessionInfo {
  return sessionRow(id, {
    heads: [
      { name: asId<"head">("main"), tip: { kind: "start" }, stack: null, execution, unread: true },
    ],
    ...change,
  });
}

/** `unread` stands for the window's answer, which the window's own tests cover. */
function glyph(row: SessionInfo, rows: readonly SessionInfo[] = [row], unread = true): string {
  return renderToStaticMarkup(<StatusGlyph mark={chatMark(row, chatsFor(rows))} unread={unread} />);
}

function grouped(
  rows: readonly SessionInfo[],
  unread: readonly SessionInfo[],
): readonly (readonly [string, readonly string[]])[] {
  return sessionsForView(
    rows,
    { ...DEFAULT_SESSION_VIEW, grouping: "status" },
    "local",
    1000,
    chatsFor(rows),
    new Set(unread.map((session) => session.id)),
  ).map((group) => [group.label ?? "", group.sessions.map((session) => session.id)]);
}

test("an unread chat shows Unread while its run draws no mark, and a read one shows nothing", () => {
  assert.match(glyph(unread("completed", COMPLETED)), /aria-label="Unread"/);
  assert.equal(glyph(sessionRow("seen"), undefined, false), "");
});

test("run marks take priority over Unread and each reads its own label", () => {
  const approval: Execution = {
    kind: "waiting",
    run,
    on: { kind: "part", part: asId<"part">("p") },
  };

  const retrying: Execution = { kind: "retrying", run, until: 2, reason: "Busy" };

  const cases = [
    [LIVE, "Running"],
    [approval, "Needs attention"],
    [retrying, "Retrying"],
    [FAILED, "Failed"],
  ] as const;

  const looks = cases.map(([execution, label]) => {
    const html = glyph(unread(label, execution));
    assert.match(html, new RegExp(`aria-label="${label}"`));
    assert.doesNotMatch(html, /Unread/);

    return html.match(/class="([^"]*)"/)?.[1] ?? "";
  });

  assert.equal(new Set(looks).size, looks.length, "every mark looks different");
});

test("a chat whose subagent still works reads as working, and a failed one needs attention", () => {
  const parent = sessionRow("parent", {}, FAILED);
  const child = sessionRow("child", { parent: parent.id }, LIVE);
  const failed = sessionRow("failed", {}, FAILED);
  const done = unread("done", COMPLETED);

  assert.match(glyph(parent, [parent, child]), /aria-label="Running"/);

  assert.deepEqual(grouped([parent, child, failed, done], [done]), [
    ["Needs attention", ["failed"]],
    ["Unread", ["done"]],
    ["Working", ["parent"]],
  ]);
});
