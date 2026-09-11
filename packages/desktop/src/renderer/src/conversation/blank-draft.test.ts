import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { PaneController } from "../layout/pane-controller.ts";
import type { PaneId } from "../layout/pane-layout.ts";

function writeDraft(controller: PaneController, text: string, paneId: PaneId = "primary"): void {
  const draft = controller.viewState.readBlank(paneId);
  controller.viewState.writeBlank(paneId, {
    ...draft,
    composer: {
      ...draft.composer,
      draft: text,
      selectionStart: text.length,
      selectionEnd: text.length,
    },
  });
}

test("new chat keeps non-empty drafts available for reopening", () => {
  const controller = new PaneController({ storageKey: "drafts" });
  writeDraft(controller, "First idea\nwith detail");
  const firstId = controller.viewState.readBlank("primary").id;

  controller.newChat();
  writeDraft(controller, "Second idea");
  const secondId = controller.viewState.readBlank("primary").id;
  controller.newChat();

  assert.deepEqual(
    controller.viewState
      .drafts()
      .map((draft) => draft.composer.draft.split("\n")[0])
      .sort(),
    ["First idea", "Second idea"],
  );
  controller.selectDraft(firstId);
  assert.equal(controller.viewState.readBlank("primary").composer.draft, "First idea\nwith detail");
  controller.selectDraft(secondId);
  assert.equal(controller.viewState.readBlank("primary").composer.draft, "Second idea");
});

test("each draft keeps its model, thinking level, and fast setting", () => {
  const controller = new PaneController({ storageKey: "draft-settings" });
  const first = controller.viewState.readBlank("primary");
  controller.viewState.writeBlank("primary", {
    ...first,
    configuration: {
      model: { provider: "provider", id: "model" },
      thinkingLevel: "high",
    },
    fastSettings: new Set(["fast"]),
  });
  writeDraft(controller, "Configured draft");
  const firstId = controller.viewState.readBlank("primary").id;
  controller.newChat();

  assert.equal(controller.viewState.readBlank("primary").configuration, undefined);
  assert.equal(controller.viewState.readBlank("primary").fastSettings.size, 0);
  controller.selectDraft(firstId);
  assert.equal(controller.viewState.readBlank("primary").configuration?.model.id, "model");
  assert.equal(controller.viewState.readBlank("primary").configuration?.thinkingLevel, "high");
  assert.ok(controller.viewState.readBlank("primary").fastSettings.has("fast"));
});

test("sidebar publication is debounced while typing", () => {
  vi.useFakeTimers();
  try {
    const controller = new PaneController({ storageKey: "draft-debounce" });
    let publications = 0;
    const unsubscribe = controller.viewState.subscribe(() => {
      publications += 1;
    });
    writeDraft(controller, "F");
    writeDraft(controller, "First");
    vi.advanceTimersByTime(199);
    assert.equal(publications, 0);
    vi.advanceTimersByTime(1);
    assert.equal(publications, 1);
    unsubscribe();
  } finally {
    vi.useRealTimers();
  }
});

test("empty new chats are reused and stay out of the draft list", () => {
  const controller = new PaneController({ storageKey: "empty-drafts" });
  const draftId = controller.viewState.readBlank("primary").id;
  controller.newChat();
  controller.newChat();
  assert.equal(controller.viewState.readBlank("primary").id, draftId);
  assert.deepEqual(controller.viewState.drafts(), []);
});

test("deleting the open draft replaces it with an empty chat", () => {
  const controller = new PaneController({ storageKey: "delete-draft" });
  writeDraft(controller, "Discard me");
  const draftId = controller.viewState.readBlank("primary").id;
  controller.removeDraft(draftId);
  assert.equal(controller.viewState.readBlank("primary").composer.draft, "");
  assert.notEqual(controller.viewState.readBlank("primary").id, draftId);
});

test("workspaces and split panes keep independent drafts", () => {
  const firstWorkspace = new PaneController({ storageKey: "first" });
  const secondWorkspace = new PaneController({ storageKey: "second" });
  writeDraft(firstWorkspace, "Primary");
  writeDraft(firstWorkspace, "Secondary", "secondary");

  assert.equal(firstWorkspace.viewState.readBlank("primary").composer.draft, "Primary");
  assert.equal(firstWorkspace.viewState.readBlank("secondary").composer.draft, "Secondary");
  assert.equal(secondWorkspace.viewState.readBlank("primary").composer.draft, "");
});
