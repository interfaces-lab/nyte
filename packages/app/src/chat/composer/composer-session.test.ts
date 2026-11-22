import { expect, test } from "vitest";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { asId } from "@nyte-ai/schema";
import type { ComposerViewState } from "../../panes/session-view-state.ts";
import type { ComposerSubmission } from "./composer-document.ts";
import type { SessionDraft } from "../../panes/composer-draft.ts";
import { CLOSED_SESSION, stepSession } from "./composer-session.ts";
import type {
  ComposerSession,
  ComposerSessionEffect,
  ComposerSessionEvent,
  EditSaved,
} from "./composer-session.ts";

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

const SUBMISSION: ComposerSubmission = { text: "Then lint.", references: [], parts: [] };

const HISTORY = { prompts: ["Third.", "Second.", "First."], before: null };

const MORE = { prompts: ["Third."], before: asId<"message">("older") };

function view(text: string): ComposerViewState {
  return { draft: text, attachments: [], selectionStart: text.length, selectionEnd: text.length };
}

const DRAFT: SessionDraft = {
  composer: view("mine"),
  edit: null,
  notice: null,
  sending: [],
  omitted: 0,
};

const typed = (text: string): ComposerSessionEvent => ({
  kind: "typed",
  document: { text, selectionStart: text.length, selectionEnd: text.length },
});

const edit: ComposerSessionEvent = { kind: "edit", message: QUEUED, asking: false };

const held = (token: number): ComposerSessionEvent => ({
  kind: "hold-answered",
  token,
  answer: { kind: "held" },
});

const ended = (token: number): ComposerSessionEvent => ({
  kind: "hold-answered",
  token,
  answer: { kind: "ended", notice: "That message was already sent." },
});

const save: ComposerSessionEvent = { kind: "save", submission: SUBMISSION, delivery: "queue" };

function effectName(effect: ComposerSessionEffect): string {
  switch (effect.kind) {
    case "hold":
    case "release":
      return `${effect.kind} ${String(effect.token)}`;
    case "save":
      return effect.held === null
        ? `save ${String(effect.token)} through revise`
        : `save ${String(effect.token)} through hold ${String(effect.held)}`;
    case "read-prompts":
      return `read ${String(effect.token)}`;
    case "focus":
    case "revised":
      return effect.kind;
    default: {
      const _exhaustive: never = effect;

      return _exhaustive;
    }
  }
}

function after(events: readonly ComposerSessionEvent[]) {
  let state: ComposerSession = CLOSED_SESSION;
  let draft = DRAFT;
  let effects: readonly ComposerSessionEffect[] = [];
  let handled = true;

  for (const event of [{ kind: "shown" } as const, ...events]) {
    const next = stepSession(state, draft, event);
    state = next.state;
    draft = next.draft;
    effects = next.effects;
    handled = next.handled;
  }

  const shown = draft.edit?.view ?? draft.composer;

  return {
    shown: shown.draft,
    hold: state.hold === null ? null : `${state.hold.phase} ${String(state.hold.token)}`,
    notice: draft.notice?.message ?? null,
    reading: state.reading,
    effects: effects.map(effectName),
    handled,
  };
}

type Summary = ReturnType<typeof after>;

const QUIET = { notice: null, reading: null, effects: [], handled: true };

test.each<{
  readonly name: string;
  readonly events: readonly ComposerSessionEvent[];
  readonly expected: Summary;
}>([
  {
    name: "Edit opens the queued message and asks the host to hold it",
    events: [edit],
    expected: {
      ...QUIET,
      shown: "Then run the tests.",
      hold: "asking 1",
      effects: ["hold 1", "focus"],
    },
  },
  {
    name: "the hold the host grants is kept",
    events: [edit, held(1)],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "held 1" },
  },
  {
    name: "a hold granted after the edit was cancelled is released",
    events: [edit, { kind: "edit-cancelled" }, held(1)],
    expected: { ...QUIET, shown: "mine", hold: null, effects: ["release 1"] },
  },
  {
    name: "an answer to an older hold is released and the newer hold stays asked",
    events: [edit, { kind: "edit-cancelled" }, edit, held(1)],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "asking 2", effects: ["release 1"] },
  },
  {
    name: "a hold the message outran ends the edit with the reason",
    events: [edit, ended(1)],
    expected: { ...QUIET, shown: "mine", hold: null, notice: "That message was already sent." },
  },
  {
    name: "a stale hold's end changes nothing",
    events: [edit, { kind: "edit-cancelled" }, edit, ended(1)],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "asking 2" },
  },
  {
    name: "a save once the hold arrived goes through the hold",
    events: [edit, held(1), save],
    expected: {
      ...QUIET,
      shown: "Then run the tests.",
      hold: "saving 2",
      effects: ["save 2 through hold 1"],
    },
  },
  {
    name: "a save before the hold arrived goes through revise, and the late hold is released",
    events: [edit, save, held(1)],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "saving 2", effects: ["release 1"] },
  },
  {
    name: "a hold lost while saving is ignored",
    events: [edit, held(1), save, ended(1)],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "saving 2" },
  },
  {
    name: "a save with nothing in it holds the message again",
    events: [edit, held(1), save, { kind: "saved", token: 2, saved: { kind: "empty" } }],
    expected: {
      ...QUIET,
      shown: "Then run the tests.",
      hold: "asking 3",
      effects: ["hold 3", "focus"],
    },
  },
  {
    name: "a refused save holds the message again and says why",
    events: [
      edit,
      held(1),
      save,
      { kind: "saved", token: 2, saved: { kind: "refused", message: "Couldn't update." } },
    ],
    expected: {
      ...QUIET,
      shown: "Then run the tests.",
      hold: "asking 3",
      notice: "Couldn't update.",
      effects: ["hold 3", "focus"],
    },
  },
  {
    name: "a revised save ends the edit",
    events: [edit, held(1), save, { kind: "saved", token: 2, saved: { kind: "revised" } }],
    expected: { ...QUIET, shown: "mine", hold: null, effects: ["focus", "revised"] },
  },
  {
    name: "a save that found the message sent ends the edit with the reason",
    events: [edit, typed("Edited."), save, { kind: "saved", token: 2, saved: { kind: "sent" } }],
    expected: {
      ...QUIET,
      shown: "Edited.\nmine",
      hold: null,
      notice: "That message was already sent.",
      effects: ["focus"],
    },
  },
  {
    name: "a save's answer for an older save changes nothing",
    events: [edit, save, { kind: "saved", token: 1, saved: { kind: "revised" } }],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "saving 2" },
  },
  {
    name: "closing the composer releases the hold",
    events: [edit, held(1), { kind: "closed" }],
    expected: { ...QUIET, shown: "mine", hold: null, effects: ["release 1"] },
  },
  {
    name: "Edit while a question asks, or during another edit, does nothing",
    events: [{ ...edit, asking: true }],
    expected: { ...QUIET, shown: "mine", hold: null },
  },
  {
    name: "recall shows the newest prompt and keeps the draft",
    events: [{ kind: "recall", direction: "older", loaded: HISTORY }],
    expected: { ...QUIET, shown: "Third.", hold: null },
  },
  {
    name: "stepping newer past the newest prompt brings the draft back",
    events: [
      { kind: "recall", direction: "older", loaded: HISTORY },
      { kind: "recall", direction: "newer", loaded: HISTORY },
    ],
    expected: { ...QUIET, shown: "mine", hold: null },
  },
  {
    name: "a recalled prompt the person edited still steps back to the draft",
    events: [
      { kind: "recall", direction: "older", loaded: HISTORY },
      typed("Third, edited."),
      { kind: "recall", direction: "newer", loaded: HISTORY },
    ],
    expected: { ...QUIET, shown: "mine", hold: null },
  },
  {
    name: "an edited prompt comes back as edited",
    events: [
      { kind: "recall", direction: "older", loaded: HISTORY },
      typed("Third, edited."),
      { kind: "recall", direction: "older", loaded: HISTORY },
      { kind: "recall", direction: "newer", loaded: HISTORY },
    ],
    expected: { ...QUIET, shown: "Third, edited.", hold: null },
  },
  {
    name: "newer with no walk passes the key on",
    events: [{ kind: "recall", direction: "newer", loaded: HISTORY }],
    expected: { ...QUIET, shown: "mine", hold: null, handled: false },
  },
  {
    name: "recall past the loaded prompts reads earlier ones",
    events: [
      { kind: "recall", direction: "older", loaded: MORE },
      { kind: "recall", direction: "older", loaded: MORE },
    ],
    expected: { ...QUIET, shown: "Third.", hold: null, reading: 1, effects: ["read 1"] },
  },
  {
    name: "earlier prompts that arrive step the walk",
    events: [
      { kind: "recall", direction: "older", loaded: MORE },
      { kind: "recall", direction: "older", loaded: MORE },
      { kind: "prompts-read", token: 1, direction: "older", history: HISTORY },
    ],
    expected: { ...QUIET, shown: "Second.", hold: null },
  },
  {
    name: "typing drops a read in flight, and its answer changes nothing",
    events: [
      { kind: "recall", direction: "older", loaded: MORE },
      { kind: "recall", direction: "older", loaded: MORE },
      typed("Third!"),
      { kind: "prompts-read", token: 1, direction: "older", history: HISTORY },
    ],
    expected: { ...QUIET, shown: "Third!", hold: null },
  },
  {
    name: "a read that fails says so",
    events: [
      { kind: "recall", direction: "older", loaded: MORE },
      { kind: "recall", direction: "older", loaded: MORE },
      { kind: "prompts-failed", token: 1, message: "Couldn't read earlier prompts: offline" },
    ],
    expected: {
      ...QUIET,
      shown: "Third.",
      hold: null,
      notice: "Couldn't read earlier prompts: offline",
    },
  },
  {
    name: "a read that fails after the person moved on says nothing",
    events: [
      { kind: "recall", direction: "older", loaded: MORE },
      { kind: "recall", direction: "older", loaded: MORE },
      typed("Moved on."),
      { kind: "prompts-failed", token: 1, message: "Couldn't read earlier prompts: offline" },
    ],
    expected: { ...QUIET, shown: "Moved on.", hold: null },
  },
  {
    name: "a notice after the composer closed is dropped",
    events: [
      { kind: "closed" },
      { kind: "notice", notice: { kind: "error", message: "Couldn't stop.", restore: null } },
    ],
    expected: { ...QUIET, shown: "mine", hold: null },
  },
  {
    name: "a save waits for files still being read",
    events: [edit, held(1), { kind: "intake", event: { kind: "reading" } }, save],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "held 1" },
  },
  {
    name: "closing while a save runs keeps the edit open and the save running",
    events: [edit, typed("Edited."), save, { kind: "closed" }],
    expected: { ...QUIET, shown: "Edited.", hold: "saving 2" },
  },
  {
    name: "a save that outlived its composer and revised the message leaves only the person's text",
    events: [
      edit,
      typed("Edited."),
      save,
      { kind: "closed" },
      { kind: "saved", token: 2, saved: { kind: "revised" } },
    ],
    expected: { ...QUIET, shown: "mine", hold: null, effects: ["revised"] },
  },
  {
    name: "a save that outlived its composer and was refused folds the edit into the person's text",
    events: [
      edit,
      typed("Edited."),
      save,
      { kind: "closed" },
      { kind: "saved", token: 2, saved: { kind: "refused", message: "Couldn't update." } },
    ],
    expected: { ...QUIET, shown: "Edited.\nmine", hold: null },
  },
  {
    name: "a save that outlived its composer and found the message sent folds the edit",
    events: [
      edit,
      typed("Edited."),
      save,
      { kind: "closed" },
      { kind: "saved", token: 2, saved: { kind: "sent" } },
    ],
    expected: { ...QUIET, shown: "Edited.\nmine", hold: null },
  },
  {
    name: "Edit during another edit does nothing",
    events: [edit, { ...edit, message: { ...QUEUED, id: asId<"message">("other") } }],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "asking 1" },
  },
  {
    name: "files are taken while no save runs",
    events: [edit, held(1), { kind: "files" }],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "held 1" },
  },
  {
    name: "files are refused while a save runs",
    events: [edit, held(1), save, { kind: "files" }],
    expected: { ...QUIET, shown: "Then run the tests.", hold: "saving 2", handled: false },
  },
  {
    name: "a send is taken while no files are read",
    events: [{ kind: "submit" }],
    expected: { ...QUIET, shown: "mine", hold: null },
  },
  {
    name: "a send waits for files still being read",
    events: [{ kind: "intake", event: { kind: "reading" } }, { kind: "submit" }],
    expected: { ...QUIET, shown: "mine", hold: null, handled: false },
  },
])("$name", (row) => {
  expect(after(row.events)).toEqual(row.expected);
});

test.each<{
  readonly name: string;
  readonly saved: EditSaved;
  readonly grantedFirst: boolean;
  readonly shown: string;
}>([
  { name: "revises it", saved: { kind: "revised" }, grantedFirst: true, shown: "mine" },
  { name: "revises it", saved: { kind: "revised" }, grantedFirst: false, shown: "mine" },
  {
    name: "is refused",
    saved: { kind: "refused", message: "Couldn't update." },
    grantedFirst: true,
    shown: "Edited.\nmine",
  },
  {
    name: "is refused",
    saved: { kind: "refused", message: "Couldn't update." },
    grantedFirst: false,
    shown: "Edited.\nmine",
  },
  { name: "finds it sent", saved: { kind: "sent" }, grantedFirst: false, shown: "Edited.\nmine" },
])(
  "a chat reopened while its closed composer's save runs holds nothing once the save $name (granted first: $grantedFirst)",
  (row) => {
    let closing: ComposerSession = CLOSED_SESSION;
    let reopened: ComposerSession = CLOSED_SESSION;
    let draft = DRAFT;
    const released: string[] = [];

    const drive = (which: "closing" | "reopened", event: ComposerSessionEvent): void => {
      const next = stepSession(which === "closing" ? closing : reopened, draft, event);

      if (which === "closing") closing = next.state;
      else reopened = next.state;
      draft = next.draft;
      released.push(
        ...next.effects.flatMap((effect) =>
          effect.kind === "release" ? [`${which} ${String(effect.token)}`] : [],
        ),
      );
    };

    for (const event of [{ kind: "shown" } as const, edit, held(1), typed("Edited."), save]) {
      drive("closing", event);
    }
    drive("closing", { kind: "closed" });
    drive("reopened", { kind: "shown" });

    if (row.grantedFirst) drive("reopened", held(1));
    drive("closing", { kind: "saved", token: 2, saved: row.saved });
    drive("reopened", row.grantedFirst ? { kind: "draft-changed" } : held(1));

    expect({
      shown: (draft.edit?.view ?? draft.composer).draft,
      holds: [closing.hold, reopened.hold],
      released,
    }).toEqual({ shown: row.shown, holds: [null, null], released: ["reopened 1"] });
  },
);

test.each<{
  readonly name: string;
  readonly events: readonly ComposerSessionEvent[];
  readonly rows: readonly string[];
}>([
  {
    name: "a row action shows for its row",
    events: [{ kind: "row", id: "a", action: { kind: "sending" }, pending: ["a", "b"] }],
    rows: ["a sending"],
  },
  {
    name: "a row that left the queue loses its action on the next one",
    events: [
      { kind: "row", id: "a", action: { kind: "sending" }, pending: ["a", "b"] },
      { kind: "row", id: "b", action: { kind: "cancelling" }, pending: ["b"] },
    ],
    rows: ["b cancelling"],
  },
  {
    name: "a revised row drops its action",
    events: [
      { kind: "row", id: "a", action: { kind: "sending" }, pending: ["a"] },
      { kind: "row", id: "a", action: null, pending: ["a"] },
    ],
    rows: [],
  },
])("$name", (row) => {
  let state: ComposerSession = CLOSED_SESSION;

  for (const event of row.events) state = stepSession(state, DRAFT, event).state;

  expect([...state.rows].map(([id, action]) => `${id} ${action.kind}`)).toEqual(row.rows);
});
