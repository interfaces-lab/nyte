import assert from "node:assert/strict";
import { test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { paneLayout, PRIMARY, runPane, selectSession, tabPanes } from "../../test/panes.ts";
import { activeSelection, paneForSession } from "./pane-layout.ts";

const first = asId<"session">("first");

const second = asId<"session">("second");

test("Undo restores both deleted chats in their panes and their original focus", () => {
  const controller = tabPanes();
  selectSession(controller, first);
  runPane(controller, { kind: "split", direction: "right" });
  selectSession(controller, second);
  runPane(controller, { kind: "focus", pane: PRIMARY });
  const restoreFirst = controller.window.hide(first);
  const restoreSecond = controller.window.hide(second);
  assert.equal(paneForSession(paneLayout(controller), first), undefined);
  assert.equal(paneForSession(paneLayout(controller), second), undefined);
  restoreSecond();
  restoreFirst();
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
  const restore = controller.window.hide(first);
  selectSession(controller, second);
  restore();
  assert.deepEqual(activeSelection(paneLayout(controller)), {
    kind: "session",
    sessionId: second,
  });
  const restoreSecond = controller.window.hide(second);
  controller.viewState.writeBlank(PRIMARY, {
    ...controller.viewState.readBlank(PRIMARY),
    composer: {
      draft: "Keep my draft",
      attachments: [],
      selectionStart: 13,
      selectionEnd: 13,
    },
  });
  restoreSecond();
  assert.equal(paneForSession(paneLayout(controller), second), undefined);
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, "Keep my draft");
});

test("deleting a background pane's chat does not move focus away from the active chat", () => {
  const controller = tabPanes();
  selectSession(controller, first);
  runPane(controller, { kind: "split", direction: "right" });
  selectSession(controller, second);
  const restore = controller.window.hide(first);
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
