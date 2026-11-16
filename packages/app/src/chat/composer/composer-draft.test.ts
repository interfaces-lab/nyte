import { expect, test } from "vitest";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { asId } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/sdk";
import type { RefusedSend } from "@nyte-ai/sdk/client";
import type { StorageArea } from "../../lib/storage.ts";
import { SessionViewStateStore } from "../../panes/session-view-state.ts";
import type { ComposerImageAttachment, ComposerViewState } from "../../panes/session-view-state.ts";
import { WindowDrafts } from "./drafts.ts";
import {
  endedDraft,
  foldEdit,
  leftDraft,
  lostEdit,
  openedEdit,
  persistedDraft,
  refusedDraft,
  replayedDraft,
  restoredDraft,
  shownDraft,
  typedDraft,
} from "./composer-draft.ts";
import type { ComposerNotice, SessionDraft } from "./composer-draft.ts";

const IMAGE: ComposerImageAttachment = {
  id: "image",
  name: "shot.png",
  content: { type: "image", data: "AAAA", mimeType: "image/png" },
};

const SENT_IMAGE: ComposerImageAttachment = { ...IMAGE, id: "sent" };

const QUEUED: UserMessage = {
  id: asId<"message">("queued"),
  turn: asId<"turn">("turn"),
  at: 1,
  kind: "user",
  content: "Then run the tests.",
  source: { kind: "user" },
  delivery: "queue",
  status: { kind: "pending", schedule: { kind: "next-turn", reason: "requested" }, covered: true },
  siblings: { index: 0, count: 1, ids: [] },
};

function view(
  text: string,
  attachments: readonly ComposerImageAttachment[] = [],
): ComposerViewState {
  return { draft: text, attachments, selectionStart: 0, selectionEnd: 0 };
}

function draft(
  text: string,
  options: { readonly edit?: string; readonly notice?: ComposerNotice } = {},
): SessionDraft {
  return {
    composer: view(text),
    edit: options.edit === undefined ? null : { message: QUEUED, view: view(options.edit) },
    notice: options.notice ?? null,
  };
}

const STATUS: ComposerNotice = { kind: "status", message: "Finish editing.", restore: null };

const ERROR: ComposerNotice = { kind: "error", message: "Couldn't stop.", restore: null };

const REFUSED: ComposerNotice = {
  kind: "error",
  message: "Refused.",
  restore: { text: "hello", attachments: [] },
};

const REPLAYED: RefusedSend = {
  id: asId<"receipt">("replayed"),
  session: asId<"session">("chat"),
  head: asId<"head">("main"),
  content: [{ kind: "text", text: "hello" }],
  error: new SdkError("invalid", "Refused."),
};

const typed = (text: string) => ({ text, selectionStart: text.length, selectionEnd: text.length });

function summary(shown: SessionDraft) {
  const notice = shown.notice;

  return {
    shown: shownDraft(shown).draft,
    kept: persistedDraft(shown).draft,
    composer: shown.composer.draft,
    images: shown.composer.attachments.map((image) => image.id).join(","),
    editing: shown.edit !== null,
    notice:
      notice === null
        ? null
        : `${notice.kind}: ${notice.message}${notice.restore === null ? "" : ` [restore "${notice.restore.text}"]`}`,
  };
}

const ROWS: readonly {
  readonly name: string;
  readonly result: SessionDraft;
  readonly expected: ReturnType<typeof summary>;
}[] = [
  {
    name: "a draft with no edit shows and keeps the person's own text",
    result: draft("mine"),
    expected: {
      shown: "mine",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: false,
      notice: null,
    },
  },
  {
    name: "a changed edit shows over the person's text and is kept on top of it",
    result: draft("mine", { edit: "Then lint." }),
    expected: {
      shown: "Then lint.",
      kept: "Then lint.\nmine",
      composer: "mine",
      images: "",
      editing: true,
      notice: null,
    },
  },
  {
    name: "an unchanged edit shows, and only the person's text is kept",
    result: draft("mine", { edit: "Then run the tests." }),
    expected: {
      shown: "Then run the tests.",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: true,
      notice: null,
    },
  },
  {
    name: "typing changes the text and clears a status notice",
    result: typedDraft(draft("mine", { notice: STATUS }), typed("mine!")),
    expected: {
      shown: "mine!",
      kept: "mine!",
      composer: "mine!",
      images: "",
      editing: false,
      notice: null,
    },
  },
  {
    name: "typing keeps an error notice",
    result: typedDraft(draft("mine", { notice: ERROR }), typed("mine!")),
    expected: {
      shown: "mine!",
      kept: "mine!",
      composer: "mine!",
      images: "",
      editing: false,
      notice: "error: Couldn't stop.",
    },
  },
  {
    name: "moving the caret keeps a status notice",
    result: typedDraft(draft("mine", { notice: STATUS }), typed("mine")),
    expected: {
      shown: "mine",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: false,
      notice: "status: Finish editing.",
    },
  },
  {
    name: "typing during an edit changes the edit, not the person's text",
    result: typedDraft(draft("mine", { edit: "Then" }), typed("Then lint")),
    expected: {
      shown: "Then lint",
      kept: "Then lint\nmine",
      composer: "mine",
      images: "",
      editing: true,
      notice: null,
    },
  },
  {
    name: "opening an edit shows the queued text and drops the notice, Restore Draft included",
    result: openedEdit(draft("mine", { notice: REFUSED }), QUEUED),
    expected: {
      shown: "Then run the tests.",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: true,
      notice: null,
    },
  },
  {
    name: "an unchanged edit whose message left the queue goes",
    result: lostEdit(draft("mine", { edit: "Then run the tests." })),
    expected: {
      shown: "mine",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: false,
      notice: null,
    },
  },
  {
    name: "a changed edit whose message left the queue joins the person's text",
    result: lostEdit(draft("mine", { edit: "Then lint." })),
    expected: {
      shown: "Then lint.\nmine",
      kept: "Then lint.\nmine",
      composer: "Then lint.\nmine",
      images: "",
      editing: false,
      notice: null,
    },
  },
  {
    name: "closing the composer leaves an unchanged edit out of the draft, and drops a notice with nothing to restore",
    result: foldEdit(draft("mine", { edit: "Then run the tests.", notice: ERROR }), "folded"),
    expected: {
      shown: "mine",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: false,
      notice: null,
    },
  },
  {
    name: "closing the composer folds a changed edit into the draft",
    result: foldEdit(draft("mine", { edit: "Then lint." }), "folded"),
    expected: {
      shown: "Then lint.\nmine",
      kept: "Then lint.\nmine",
      composer: "Then lint.\nmine",
      images: "",
      editing: false,
      notice: null,
    },
  },
  {
    name: "closing the composer keeps a notice that can still restore",
    result: foldEdit(draft("mine", { notice: REFUSED }), "folded"),
    expected: {
      shown: "mine",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: false,
      notice: 'error: Refused. [restore "hello"]',
    },
  },
  {
    name: "a send leaves: its text and images go",
    result: leftDraft(
      { ...draft("hello"), composer: view("hello", [SENT_IMAGE, IMAGE]) },
      typed("hello"),
      [SENT_IMAGE],
    ),
    expected: { shown: "", kept: "", composer: "", images: "image", editing: false, notice: null },
  },
  {
    name: "a send leaves after the text changed: the new text stays",
    result: leftDraft(draft("hello again"), typed("hello"), []),
    expected: {
      shown: "hello again",
      kept: "hello again",
      composer: "hello again",
      images: "",
      editing: false,
      notice: null,
    },
  },
  {
    name: "a refusal on an empty draft gives the text and images back at once",
    result: refusedDraft(draft(""), "Refused.", { text: "hello", attachments: [SENT_IMAGE] }),
    expected: {
      shown: "hello",
      kept: "hello",
      composer: "hello",
      images: "sent",
      editing: false,
      notice: "error: Refused.",
    },
  },
  {
    name: "a refusal on a draft with text keeps it and offers Restore Draft",
    result: refusedDraft(draft("next"), "Refused.", { text: "hello", attachments: [] }),
    expected: {
      shown: "next",
      kept: "next",
      composer: "next",
      images: "",
      editing: false,
      notice: 'error: Refused. [restore "hello"]',
    },
  },
  {
    name: "a refusal during an edit restores into the person's empty draft, not the edit",
    result: refusedDraft(draft("", { edit: "Then run the tests." }), "Refused.", {
      text: "hello",
      attachments: [],
    }),
    expected: {
      shown: "Then run the tests.",
      kept: "hello",
      composer: "hello",
      images: "",
      editing: true,
      notice: "error: Refused.",
    },
  },
  {
    name: "a refusal during an edit over text offers Restore Draft and leaves the edit alone",
    result: refusedDraft(draft("mine", { edit: "Then run the tests." }), "Refused.", {
      text: "hello",
      attachments: [],
    }),
    expected: {
      shown: "Then run the tests.",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: true,
      notice: 'error: Refused. [restore "hello"]',
    },
  },
  {
    name: "a send the journal still holds leaves an empty draft empty",
    result: endedDraft(draft(""), { kind: "unsent" }, { text: "hello", attachments: [] }),
    expected: { shown: "", kept: "", composer: "", images: "", editing: false, notice: null },
  },
  {
    name: "a send whose unsent row was removed leaves the draft alone",
    result: endedDraft(draft("next"), { kind: "removed" }, { text: "hello", attachments: [] }),
    expected: {
      shown: "next",
      kept: "next",
      composer: "next",
      images: "",
      editing: false,
      notice: null,
    },
  },
  {
    name: "a refused send gives its text back",
    result: endedDraft(
      draft(""),
      { kind: "refused", message: "Refused." },
      { text: "hello", attachments: [] },
    ),
    expected: {
      shown: "hello",
      kept: "hello",
      composer: "hello",
      images: "",
      editing: false,
      notice: "error: Refused.",
    },
  },
  {
    name: "a replayed send the host refused gives its text back to an empty draft",
    result: replayedDraft(draft(""), REPLAYED),
    expected: {
      shown: "hello",
      kept: "hello",
      composer: "hello",
      images: "",
      editing: false,
      notice: "error: Couldn't send the message: Refused.",
    },
  },
  {
    name: "a replayed send the host refused offers Restore Draft over the person's text",
    result: replayedDraft(draft("mine"), REPLAYED),
    expected: {
      shown: "mine",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: false,
      notice: `error: Couldn't send the message: Refused. [restore "hello"]`,
    },
  },
  {
    name: "Restore Draft puts the text in front and keeps the message",
    result: restoredDraft(draft("next", { notice: REFUSED })),
    expected: {
      shown: "hello\nnext",
      kept: "hello\nnext",
      composer: "hello\nnext",
      images: "",
      editing: false,
      notice: "error: Refused.",
    },
  },
  {
    name: "Restore Draft during an edit restores into the person's draft",
    result: restoredDraft(draft("next", { edit: "Then", notice: REFUSED })),
    expected: {
      shown: "Then",
      kept: "Then\nhello\nnext",
      composer: "hello\nnext",
      images: "",
      editing: true,
      notice: "error: Refused.",
    },
  },
];

test.each(ROWS)("$name", (row) => {
  expect(summary(row.result)).toEqual(row.expected);
});

const STORE_KEY = "drafts";

const CHAT = asId<"session">("chat");

const LARGE_IMAGE: ComposerImageAttachment = {
  ...IMAGE,
  id: "large",
  content: { ...IMAGE.content, data: "A".repeat(256 * 1024 + 1) },
};

function memoryArea(): StorageArea & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();

  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function reloaded(area: StorageArea) {
  const shown = new WindowDrafts({ storage: area, storageKey: STORE_KEY }).sessions.get(
    CHAT,
  )?.draft;

  return shown === undefined
    ? null
    : {
        ...summary(shown),
        restoring: shown.notice?.restore?.attachments.map((image) => image.id).join(",") ?? null,
      };
}

test.each<{
  readonly name: string;
  readonly drafts: readonly SessionDraft[];
  readonly stored?: Readonly<Record<string, unknown>>;
  readonly expected: ReturnType<typeof reloaded>;
}>([
  {
    name: "a Restore Draft notice comes back after a reload, with its text and images",
    drafts: [
      {
        ...draft("mine"),
        notice: { ...REFUSED, restore: { text: "hello", attachments: [IMAGE, LARGE_IMAGE] } },
      },
    ],
    expected: {
      shown: "mine",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: false,
      notice: 'error: Refused. [restore "hello"]',
      restoring: "image",
    },
  },
  {
    name: "a Restore Draft notice over an empty draft is kept on its own",
    drafts: [{ ...draft(""), notice: REFUSED }],
    expected: {
      shown: "",
      kept: "",
      composer: "",
      images: "",
      editing: false,
      notice: 'error: Refused. [restore "hello"]',
      restoring: "",
    },
  },
  {
    name: "a restored or dismissed notice is not offered again after a reload",
    drafts: [
      { ...draft(""), notice: REFUSED },
      { ...draft(""), notice: null },
    ],
    expected: null,
  },
  {
    name: "a notice with nothing to restore is not stored",
    drafts: [{ ...draft("mine"), notice: ERROR }],
    expected: {
      shown: "mine",
      kept: "mine",
      composer: "mine",
      images: "",
      editing: false,
      notice: null,
      restoring: null,
    },
  },
  {
    name: "a draft stored before Restore Draft was stored still loads",
    drafts: [],
    stored: {
      [STORE_KEY]: { tabs: {}, sessions: [CHAT] },
      [`${STORE_KEY}:session:${CHAT}`]: { draft: "older", selectionStart: 0, selectionEnd: 0 },
    },
    expected: {
      shown: "older",
      kept: "older",
      composer: "older",
      images: "",
      editing: false,
      notice: null,
      restoring: null,
    },
  },
])("$name", (row) => {
  const area = memoryArea();

  for (const [key, value] of Object.entries(row.stored ?? {}))
    area.setItem(key, JSON.stringify(value));
  const window = new WindowDrafts({ storage: area, storageKey: STORE_KEY });
  const store = new SessionViewStateStore(window, "tab");

  for (const next of row.drafts) store.updateDraft(CHAT, () => next);
  window.emit();

  expect(reloaded(area)).toEqual(row.expected);
});
