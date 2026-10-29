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

function unread(
  id: string,
  execution: Execution,
  background = { working: 0, waiting: 0 },
): SessionInfo {
  return sessionRow(id, {
    heads: [
      {
        name: asId<"head">("main"),
        tip: { kind: "start" },
        stack: null,
        execution,
        unread: true,
        background,
      },
    ],
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
    [LIVE, "Running", 0],
    [approval, "Needs attention", 0],
    [retrying, "Retrying", 0],
    [FAILED, "Failed", 0],
    [COMPLETED, "Working in the background", 1],
  ] as const;

  const looks = cases.map(([execution, label, working]) => {
    const html = glyph(unread(label, execution, { working, waiting: 0 }));
    assert.match(html, new RegExp(`aria-label="${label}"`));
    assert.doesNotMatch(html, /Unread/);

    return html.match(/class="([^"]*)"/)?.[1] ?? "";
  });

  assert.equal(new Set(looks).size, looks.length, "every mark looks different");
});

test("a chat whose own run ended draws its background work but sorts by its own run, and work waiting on the user needs attention", () => {
  const busy = unread("busy", COMPLETED, { working: 1, waiting: 0 });
  const asking = unread("asking", COMPLETED, { working: 1, waiting: 1 });
  const failed = sessionRow("failed", {}, FAILED);
  const done = unread("done", COMPLETED);

  assert.match(glyph(busy, [busy], false), /aria-label="Working in the background"/);
  assert.match(glyph(asking, [asking], false), /aria-label="Needs attention"/);

  assert.deepEqual(grouped([busy, asking, failed, done], [done]), [
    ["Needs attention", ["asking", "failed"]],
    ["Unread", ["done"]],
    ["Done", ["busy"]],
  ]);
});
