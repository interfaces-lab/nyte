import assert from "node:assert/strict";
import { test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { PRIMARY, tabPanes } from "../../test/panes.ts";
import { activeSelection, paneForSession } from "./pane-layout.ts";

const first = asId<"session">("first");

const second = asId<"session">("second");

test("Undo restores both archived panes and their original focus", () => {
  const controller = tabPanes();
  controller.selectSession(first);
  controller.split("right");
  controller.selectSession(second);
  controller.focus(PRIMARY);
  const restoreFirst = controller.removeSessionWithUndo(first);
  const restoreSecond = controller.removeSessionWithUndo(second);
  assert.equal(paneForSession(controller.getSnapshot(), first), undefined);
  assert.equal(paneForSession(controller.getSnapshot(), second), undefined);
  assert.equal(restoreSecond(), true);
  assert.equal(restoreFirst(), true);
  assert.ok(paneForSession(controller.getSnapshot(), first));
  assert.ok(paneForSession(controller.getSnapshot(), second));
  assert.deepEqual(activeSelection(controller.getSnapshot()), {
    kind: "session",
    sessionId: first,
  });
});

test("Undo never replaces a newer chat or a new draft", () => {
  const controller = tabPanes();
  controller.selectSession(first);
  const restore = controller.removeSessionWithUndo(first);
  controller.selectSession(second);
  assert.equal(restore(), false);
  assert.deepEqual(activeSelection(controller.getSnapshot()), {
    kind: "session",
    sessionId: second,
  });
  const restoreSecond = controller.removeSessionWithUndo(second);
  controller.viewState.writeBlank(PRIMARY, {
    ...controller.viewState.readBlank(PRIMARY),
    composer: {
      draft: "Keep my draft",
      attachments: [],
      selectionStart: 13,
      selectionEnd: 13,
      focused: true,
    },
  });
  assert.equal(restoreSecond(), false);
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, "Keep my draft");
});

test("archiving a background pane does not move focus away from the active chat", () => {
  const controller = tabPanes();
  controller.selectSession(first);
  controller.split("right");
  controller.selectSession(second);
  const restore = controller.removeSessionWithUndo(first);
  assert.deepEqual(activeSelection(controller.getSnapshot()), {
    kind: "session",
    sessionId: second,
  });
  restore();
  assert.ok(paneForSession(controller.getSnapshot(), first));
  assert.deepEqual(activeSelection(controller.getSnapshot()), {
    kind: "session",
    sessionId: second,
  });
});
