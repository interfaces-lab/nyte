import assert from "node:assert/strict";
import { test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { paneLayout, PRIMARY, runPane, selectSession, tabPanes } from "../../test/panes.ts";
import { activeSelection, paneForSession } from "./pane-layout.ts";

const first = asId<"session">("first");

const second = asId<"session">("second");

test("Undo restores both archived panes and their original focus", () => {
  const controller = tabPanes();
  selectSession(controller, first);
  runPane(controller, { kind: "split", direction: "right" });
  selectSession(controller, second);
  runPane(controller, { kind: "focus", pane: PRIMARY });
  const restoreFirst = controller.window.hide(controller.tabId, first);
  const restoreSecond = controller.window.hide(controller.tabId, second);
  assert.equal(paneForSession(paneLayout(controller), first), undefined);
  assert.equal(paneForSession(paneLayout(controller), second), undefined);
  assert.equal(restoreSecond(), true);
  assert.equal(restoreFirst(), true);
  assert.ok(paneForSession(paneLayout(controller), first));
  assert.ok(paneForSession(paneLayout(controller), second));
  assert.deepEqual(activeSelection(paneLayout(controller)), {
    kind: "session",
    sessionId: first,
  });
});

test("Undo never replaces a newer chat or a new draft", () => {
  const controller = tabPanes();
  selectSession(controller, first);
  const restore = controller.window.hide(controller.tabId, first);
  selectSession(controller, second);
  assert.equal(restore(), false);
  assert.deepEqual(activeSelection(paneLayout(controller)), {
    kind: "session",
    sessionId: second,
  });
  const restoreSecond = controller.window.hide(controller.tabId, second);
  controller.viewState.writeBlank(PRIMARY, {
    ...controller.viewState.readBlank(PRIMARY),
    composer: {
      draft: "Keep my draft",
      attachments: [],
      selectionStart: 13,
      selectionEnd: 13,
    },
  });
  assert.equal(restoreSecond(), false);
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, "Keep my draft");
});

test("archiving a background pane does not move focus away from the active chat", () => {
  const controller = tabPanes();
  selectSession(controller, first);
  runPane(controller, { kind: "split", direction: "right" });
  selectSession(controller, second);
  const restore = controller.window.hide(controller.tabId, first);
  assert.deepEqual(activeSelection(paneLayout(controller)), {
    kind: "session",
    sessionId: second,
  });
  restore();
  assert.ok(paneForSession(paneLayout(controller), first));
  assert.deepEqual(activeSelection(paneLayout(controller)), {
    kind: "session",
    sessionId: second,
  });
});
