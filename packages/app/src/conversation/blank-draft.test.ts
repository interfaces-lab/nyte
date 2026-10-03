import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
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

test("active draft removal does not depend on the sidebar content index", () => {
  const controller = new PaneController({ storageKey: "remove-active-empty-draft" });
  writeDraft(controller, "Submitted text");
  const draftId = controller.viewState.readBlank("primary").id;
  writeDraft(controller, "");

  assert.deepEqual(controller.viewState.drafts(), []);
  assert.equal(controller.viewState.removeDraft(draftId), true);
  assert.notEqual(controller.viewState.readBlank("primary").id, draftId);
});

test("taking a draft owns the live editor document and clears the pane immediately", () => {
  const controller = new PaneController({ storageKey: "take-live-draft" });
  writeDraft(controller, "Stale parent text");
  const composer = controller.viewState.readBlank("primary").composer;
  const text = "Pasted reference\n\nFirst request";
  const published: string[] = [];

  const unsubscribe = controller.viewState.subscribe(() => {
    published.push(controller.viewState.readBlank("primary").composer.draft);
  });

  const submitted = controller.viewState.takeBlank("primary", {
    ...composer,
    draft: text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });

  assert.equal(submitted.composer.draft, text);
  assert.equal(controller.viewState.readBlank("primary").composer.draft, "");
  assert.deepEqual(controller.viewState.drafts(), []);
  assert.deepEqual(published, [""]);

  controller.viewState.restoreBlank("primary", submitted);
  assert.equal(controller.viewState.readBlank("primary").composer.draft, text);
  unsubscribe();
});

test("restoring a failed send parks it instead of replacing a newer draft", () => {
  const controller = new PaneController({ storageKey: "restore-sent-draft" });
  writeDraft(controller, "First request");

  const submitted = controller.viewState.takeBlank(
    "primary",
    controller.viewState.readBlank("primary").composer,
  );

  writeDraft(controller, "Second request");

  controller.viewState.restoreBlank("primary", submitted);

  assert.equal(controller.viewState.readBlank("primary").composer.draft, "Second request");
  assert.deepEqual(
    controller.viewState
      .drafts()
      .map((draft) => draft.composer.draft)
      .sort(),
    ["First request", "Second request"],
  );
});

test("late removal of a parked draft preserves the pane's newer draft", () => {
  const controller = new PaneController({ storageKey: "late-draft-removal" });
  writeDraft(controller, "Already submitted");
  const submittedId = controller.viewState.readBlank("primary").id;
  controller.newChat();
  writeDraft(controller, "New request");
  const currentId = controller.viewState.readBlank("primary").id;

  assert.equal(controller.viewState.removeDraft(submittedId), true);
  assert.equal(controller.viewState.readBlank("primary").id, currentId);
  assert.equal(controller.viewState.readBlank("primary").composer.draft, "New request");
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

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("reload restores parked drafts and follow-up text", () => {
  const storage = memoryStorage();
  const first = new PaneController({ storage, storageKey: "panes-reload" });
  const opened = first.viewState.readBlank("primary");
  writeDraft(first, "First idea");
  first.newChat();
  writeDraft(first, "Second idea");
  const chat = sessionId("chat-1");
  first.viewState.updateSession(chat, "primary", (current) => ({
    ...current,
    composer: {
      draft: "Follow-up after reload",
      attachments: [],
      selectionStart: 8,
      selectionEnd: 8,
      focused: true,
    },
  }));

  const reloaded = new PaneController({ storage, storageKey: "panes-reload" });
  assert.equal(reloaded.viewState.readBlank("primary").composer.draft, "Second idea");
  reloaded.selectDraft(opened.id);
  assert.equal(reloaded.viewState.readBlank("primary").composer.draft, "First idea");
  const followUp = reloaded.viewState.readSession(chat, "primary").composer;
  assert.equal(followUp.draft, "Follow-up after reload");
  assert.equal(followUp.selectionStart, 8);
  assert.equal(followUp.focused, false);
});

test("corrupt stored drafts are ignored", () => {
  const storage = memoryStorage();
  storage.setItem("panes-corrupt:composer-drafts", "{not-json");
  const controller = new PaneController({ storage, storageKey: "panes-corrupt" });
  assert.equal(controller.viewState.readBlank("primary").composer.draft, "");
  assert.deepEqual(controller.viewState.drafts(), []);
});

test("sending a draft writes the empty composer before the window reloads", () => {
  const storage = memoryStorage();
  const first = new PaneController({ storage, storageKey: "panes-send" });
  writeDraft(first, "Send me");
  first.viewState.takeBlank("primary", first.viewState.readBlank("primary").composer);

  const reloaded = new PaneController({ storage, storageKey: "panes-send" });
  assert.equal(reloaded.viewState.readBlank("primary").composer.draft, "");
  assert.deepEqual(reloaded.viewState.drafts(), []);
});
