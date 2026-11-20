import assert from "node:assert/strict";
import { asId } from "@nyte-ai/schema";
import { test } from "vitest";
import { dropHolder, leaveWindow, reportVisibility } from "./browser-surface.ts";
import { holderKey } from "../../shared/browser-agent.ts";
import type { BrowserHolder } from "../../shared/browser-agent.ts";

const agent: BrowserHolder = { kind: "session", session: asId("agent") };

const tab = (window: number): BrowserHolder => ({ kind: "tab", window });

test("a page shared by two windows' tabs stays held and shown until the window showing it lets go", () => {
  const page: Parameters<typeof reportVisibility>[0] = {
    holders: new Map(
      [agent, tab(1), tab(2)].map((holder): [string, BrowserHolder] => [holderKey(holder), holder]),
    ),
    home: undefined,
    visible: false,
  };

  assert.equal(reportVisibility(page, 2, true), "moved");
  assert.equal(reportVisibility(page, 1, true), "moved");
  assert.equal(reportVisibility(page, 2, false), "ignored");
  assert.deepEqual({ home: page.home, visible: page.visible }, { home: 1, visible: true });

  assert.equal(dropHolder(page, tab(2)), "held");
  assert.equal(leaveWindow(page, 2), "absent");
  assert.deepEqual({ home: page.home, visible: page.visible }, { home: 1, visible: true });

  assert.equal(reportVisibility(page, 1, false), "kept");
  assert.equal(page.visible, false);
  assert.equal(reportVisibility(page, 1, true), "kept");

  assert.equal(leaveWindow(page, 1), "held");
  assert.deepEqual({ home: page.home, visible: page.visible }, { home: undefined, visible: false });
  assert.equal(dropHolder(page, agent), "unheld");
});
