import assert from "node:assert/strict";
import { test } from "vitest";
import { dropHolder, leaveWindow, reportVisibility, viewHolder } from "./browser-surface.ts";
import type { BrowserHolder } from "../../shared/browser-agent.ts";

test("a page shared by two windows' tabs stays held and shown until the window showing it lets go", () => {
  const page: Parameters<typeof reportVisibility>[0] = {
    holders: new Set<BrowserHolder>(["session:agent", viewHolder(1), viewHolder(2)]),
    home: undefined,
    visible: false,
  };

  assert.equal(reportVisibility(page, 2, true), "moved");
  assert.equal(reportVisibility(page, 1, true), "moved");
  assert.equal(reportVisibility(page, 2, false), "ignored");
  assert.deepEqual({ home: page.home, visible: page.visible }, { home: 1, visible: true });

  assert.equal(dropHolder(page, viewHolder(2)), "held");
  assert.equal(leaveWindow(page, 2), "absent");
  assert.deepEqual({ home: page.home, visible: page.visible }, { home: 1, visible: true });

  assert.equal(reportVisibility(page, 1, false), "kept");
  assert.equal(page.visible, false);
  assert.equal(reportVisibility(page, 1, true), "kept");

  assert.equal(leaveWindow(page, 1), "held");
  assert.deepEqual({ home: page.home, visible: page.visible }, { home: undefined, visible: false });
  assert.equal(dropHolder(page, "session:agent"), "unheld");
});
