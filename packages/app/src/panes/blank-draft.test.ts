import assert from "node:assert/strict";
import { PRIMARY, tabPanes } from "../../test/panes.ts";
import { onTestFinished, test, vi } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { PaneController } from "./pane-controller.ts";
import { activeSelection } from "./pane-layout.ts";
import type { PaneId } from "./layout.ts";
import type { ComposerImageAttachment } from "./session-view-state.ts";

function writeDraft(controller: PaneController, text: string, paneId: PaneId = PRIMARY): void {
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
  const controller = tabPanes();
  writeDraft(controller, "First idea\nwith detail");
  const firstId = controller.viewState.readBlank(PRIMARY).id;

  controller.newChat();
  writeDraft(controller, "Second idea");
  const secondId = controller.viewState.readBlank(PRIMARY).id;
  controller.newChat();

  assert.deepEqual(
    controller.viewState
      .drafts()
      .map((draft) => draft.composer.draft.split("\n")[0])
      .sort(),
    ["First idea", "Second idea"],
  );
  controller.selectDraft(firstId);
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, "First idea\nwith detail");
  controller.selectDraft(secondId);
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, "Second idea");
});

test("sidebar publication is debounced while typing", () => {
  vi.useFakeTimers();

  try {
    const controller = tabPanes();
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
  const controller = tabPanes();
  const draftId = controller.viewState.readBlank(PRIMARY).id;
  controller.newChat();
  controller.newChat();
  assert.equal(controller.viewState.readBlank(PRIMARY).id, draftId);
  assert.deepEqual(controller.viewState.drafts(), []);
});

test("deleting the open draft replaces it with an empty chat", () => {
  const controller = tabPanes();
  writeDraft(controller, "Discard me");
  const draftId = controller.viewState.readBlank(PRIMARY).id;
  controller.removeDraft(draftId);
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, "");
  assert.notEqual(controller.viewState.readBlank(PRIMARY).id, draftId);
});

test("active draft removal does not depend on the sidebar content index", () => {
  const controller = tabPanes();
  writeDraft(controller, "Submitted text");
  const draftId = controller.viewState.readBlank(PRIMARY).id;
  writeDraft(controller, "");

  assert.deepEqual(controller.viewState.drafts(), []);
  assert.equal(controller.viewState.removeDraft(draftId), true);
  assert.notEqual(controller.viewState.readBlank(PRIMARY).id, draftId);
});

test("a send holds the live editor document under the draft's id and refuses a second", () => {
  const controller = tabPanes();
  writeDraft(controller, "Stale parent text");
  const { id, composer } = controller.viewState.readBlank(PRIMARY);
  const text = "Pasted reference\n\nFirst request";

  const status = controller.viewState.beginSend(PRIMARY, {
    ...composer,
    draft: text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });

  const held = controller.viewState.readBlank(PRIMARY);
  assert.equal(held.id, id);
  assert.equal(held.composer.draft, text);
  assert.equal(held.status, status);
  assert.equal(controller.viewState.beginSend(PRIMARY, held.composer), undefined);

  controller.viewState.cancelSend(id);
  assert.equal(controller.viewState.readBlank(PRIMARY).id, id);
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, text);
  assert.equal(controller.viewState.readBlank(PRIMARY).status.kind, "editing");
});

test("a send belongs to its draft: parking keeps it, and a start under way cannot be withdrawn", () => {
  const controller = tabPanes();
  writeDraft(controller, "First request");
  const { id, composer } = controller.viewState.readBlank(PRIMARY);
  const waiting = controller.viewState.beginSend(PRIMARY, composer);
  assert.ok(waiting !== undefined);

  controller.newChat();
  assert.equal(controller.viewState.readDraft(id)?.status, waiting);

  assert.equal(controller.viewState.commitSend(id, waiting), true);
  assert.equal(controller.viewState.commitSend(id, waiting), false);
  controller.viewState.cancelSend(id);
  assert.equal(controller.viewState.readDraft(id)?.status.kind, "starting");

  controller.viewState.failSend(id, { kind: "failed", cause: "host went away" });
  assert.deepEqual(controller.viewState.readDraft(id)?.status, {
    kind: "failed",
    cause: "host went away",
  });
  assert.equal(controller.viewState.readDraft(id)?.composer.draft, "First request");
});

test("a started draft opens its chat only in the pane that shows it", () => {
  const controller = tabPanes();
  writeDraft(controller, "Started elsewhere");
  const { id } = controller.viewState.readBlank(PRIMARY);
  const other = asId<"session">("other");
  controller.selectSession(other);

  controller.openDraftChat(id, asId<"session">(id));
  assert.deepEqual(activeSelection(controller.getSnapshot()), {
    kind: "session",
    sessionId: other,
  });
  assert.equal(controller.viewState.readDraft(id), undefined);
});

test("late removal of a parked draft preserves the pane's newer draft", () => {
  const controller = tabPanes();
  writeDraft(controller, "Already submitted");
  const submittedId = controller.viewState.readBlank(PRIMARY).id;
  controller.newChat();
  writeDraft(controller, "New request");
  const currentId = controller.viewState.readBlank(PRIMARY).id;

  assert.equal(controller.viewState.removeDraft(submittedId), true);
  assert.equal(controller.viewState.readBlank(PRIMARY).id, currentId);
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, "New request");
});

test("workspaces and split panes keep independent drafts", () => {
  const firstWorkspace = tabPanes();
  const secondWorkspace = tabPanes();
  const secondary = asId<"pane">("secondary");
  writeDraft(firstWorkspace, "Primary");
  writeDraft(firstWorkspace, "Secondary", secondary);

  assert.equal(firstWorkspace.viewState.readBlank(PRIMARY).composer.draft, "Primary");
  assert.equal(firstWorkspace.viewState.readBlank(secondary).composer.draft, "Secondary");
  assert.equal(secondWorkspace.viewState.readBlank(PRIMARY).composer.draft, "");
});

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("reload restores parked drafts and follow-up text after a typing pause", () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const storage = memoryStorage();
  const first = tabPanes({ storage, storageKey: "panes-reload" });
  const opened = first.viewState.readBlank(PRIMARY);
  writeDraft(first, "First idea");
  first.newChat();
  writeDraft(first, "Second idea");
  const chat = asId<"session">("chat-1");
  first.viewState.updateSession(chat, (current) => ({
    ...current,
    composer: {
      draft: "Follow-up after reload",
      attachments: [],
      selectionStart: 8,
      selectionEnd: 8,
      focused: true,
    },
  }));
  vi.advanceTimersByTime(200);

  const reloaded = tabPanes({ storage, storageKey: "panes-reload" });
  assert.equal(reloaded.viewState.readBlank(PRIMARY).composer.draft, "Second idea");
  reloaded.selectDraft(opened.id);
  assert.equal(reloaded.viewState.readBlank(PRIMARY).composer.draft, "First idea");
  const followUp = reloaded.viewState.readSession(chat).composer;
  assert.equal(followUp.draft, "Follow-up after reload");
  assert.equal(followUp.selectionStart, 8);
  assert.equal(followUp.focused, false);
});

test("corrupt stored drafts are ignored", () => {
  const storage = memoryStorage();
  storage.setItem("panes-corrupt", "{not-json");
  const controller = tabPanes({ storage, storageKey: "panes-corrupt" });
  assert.equal(controller.viewState.readBlank(PRIMARY).composer.draft, "");
  assert.deepEqual(controller.viewState.drafts(), []);
});

test("a send waiting at reload comes back as an editable draft under its id", () => {
  const storage = memoryStorage();
  const first = tabPanes({ storage, storageKey: "panes-send" });
  writeDraft(first, "Send me");
  const { id, composer } = first.viewState.readBlank(PRIMARY);
  first.viewState.beginSend(PRIMARY, composer);

  const reloaded = tabPanes({ storage, storageKey: "panes-send" });
  assert.equal(reloaded.viewState.readBlank(PRIMARY).id, id);
  assert.equal(reloaded.viewState.readBlank(PRIMARY).composer.draft, "Send me");
  assert.equal(reloaded.viewState.readBlank(PRIMARY).status.kind, "editing");
});

test("a started chat's draft is written away before the window reloads", () => {
  const storage = memoryStorage();
  const first = tabPanes({ storage, storageKey: "panes-started" });
  writeDraft(first, "Send me");
  const { id, composer } = first.viewState.readBlank(PRIMARY);
  first.viewState.beginSend(PRIMARY, composer);
  first.viewState.removeDraft(id);

  const reloaded = tabPanes({ storage, storageKey: "panes-started" });
  assert.equal(reloaded.viewState.readBlank(PRIMARY).composer.draft, "");
  assert.deepEqual(reloaded.viewState.drafts(), []);
});

test("a reload keeps a draft's text and small images but not an image too large to store", () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const storage = memoryStorage();
  const first = tabPanes({ storage, storageKey: "panes-images" });
  const draft = first.viewState.readBlank(PRIMARY);

  const image = (id: string, size: number) =>
    ({
      id,
      name: `${id}.png`,
      content: { type: "image", data: "A".repeat(size), mimeType: "image/png" },
    }) satisfies ComposerImageAttachment;

  first.viewState.writeBlank(PRIMARY, {
    ...draft,
    composer: {
      ...draft.composer,
      draft: "Look at these",
      attachments: [image("icon", 1024), image("screenshot", 4 * 1024 * 1024)],
    },
  });
  vi.advanceTimersByTime(200);

  const reloaded = tabPanes({ storage, storageKey: "panes-images" });
  const composer = reloaded.viewState.readBlank(PRIMARY).composer;
  assert.equal(composer.draft, "Look at these");
  assert.deepEqual(
    composer.attachments.map((attachment) => attachment.id),
    ["icon"],
  );
});

test("a draft the storage refuses doesn't stop the other drafts or the index from being written", () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const values = memoryStorage();
  let refused = "";

  const storage = {
    ...values,
    setItem: (key: string, value: string) => {
      if (refused !== "" && key.includes(refused))
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      values.setItem(key, value);
    },
  };

  const first = tabPanes({ storage, storageKey: "panes-refused" });
  writeDraft(first, "Refused");
  refused = first.viewState.readBlank(PRIMARY).id;
  first.newChat();
  writeDraft(first, "Kept");
  vi.advanceTimersByTime(200);

  const reloaded = tabPanes({ storage: values, storageKey: "panes-refused" });
  assert.equal(reloaded.viewState.readBlank(PRIMARY).composer.draft, "Kept");
});
