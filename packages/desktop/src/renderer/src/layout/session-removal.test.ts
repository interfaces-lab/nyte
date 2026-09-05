import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import { PaneController } from "./pane-controller.ts";
import { activeSelection, paneForSession, visibleSessionIds } from "./pane-layout.ts";

const first = sessionId("first");
const second = sessionId("second");

test("Undo restores both archived panes and their original focus", () => {
  const controller = new PaneController({ storageKey: "test" });
  controller.selectSession(first);
  controller.split("right");
  controller.selectSession(second);
  controller.focus("primary");
  const restoreFirst = controller.removeSessionWithUndo(first);
  const restoreSecond = controller.removeSessionWithUndo(second);
  assert.equal(visibleSessionIds(controller.getSnapshot().layout).size, 0);
  assert.equal(restoreSecond(), true);
  assert.equal(restoreFirst(), true);
  assert.deepEqual(visibleSessionIds(controller.getSnapshot().layout), new Set([first, second]));
  assert.deepEqual(activeSelection(controller.getSnapshot().layout), {
    kind: "session",
    sessionId: first,
  });
});

test("Undo never replaces a newer chat or a new draft", () => {
  const controller = new PaneController({ storageKey: "test" });
  controller.selectSession(first);
  const restore = controller.removeSessionWithUndo(first);
  controller.selectSession(second);
  assert.equal(restore(), false);
  assert.deepEqual(activeSelection(controller.getSnapshot().layout), {
    kind: "session",
    sessionId: second,
  });
  const restoreSecond = controller.removeSessionWithUndo(second);
  controller.viewState.writeBlank("primary", {
    composer: { draft: "Keep my draft", selectionStart: 13, selectionEnd: 13, focused: true },
  });
  assert.equal(restoreSecond(), false);
  assert.equal(controller.viewState.readBlank("primary").composer.draft, "Keep my draft");
});

test("archiving a background pane does not move focus away from the active chat", () => {
  const controller = new PaneController({ storageKey: "test" });
  controller.selectSession(first);
  controller.split("right");
  controller.selectSession(second);
  const restore = controller.removeSessionWithUndo(first);
  assert.deepEqual(activeSelection(controller.getSnapshot().layout), {
    kind: "session",
    sessionId: second,
  });
  restore();
  assert.ok(paneForSession(controller.getSnapshot().layout, first));
  assert.deepEqual(activeSelection(controller.getSnapshot().layout), {
    kind: "session",
    sessionId: second,
  });
});
