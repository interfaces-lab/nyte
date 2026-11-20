import assert from "node:assert/strict";
import { test } from "vitest";
import type { OpenQuestion } from "@nyte-ai/plugin/question/schema";
import { asId } from "@nyte-ai/schema";
import type { ComposerDocumentState } from "../composer/composer-document.ts";
import type { Ask } from "./asks.ts";
import { dockView, stepDock } from "./question-dock.ts";
import type { DockEvent, Reply, RequestDraft } from "./question-dock.ts";

const OPTIONS = [
  { label: "Yes", description: "" },
  { label: "No", description: "" },
];

function ask(
  chat: string,
  part: string,
  fields: readonly ("single" | "multiple")[] = ["single"],
): Ask<OpenQuestion> {
  const sessionId = asId<"session">(chat);

  return {
    sessionId,
    request: {
      part: asId<"part">(part),
      late: false,
      questions: fields.map((kind, index) => {
        const field = {
          header: `H${String(index)}`,
          question: `${part} ${String(index)}`,
          options: OPTIONS,
        };

        return kind === "multiple" ? { ...field, multiple: true } : field;
      }),
    },
    origin: chat === "own" ? undefined : { title: chat, sessionId },
  };
}

function typed(text: string, at = text.length): ComposerDocumentState {
  return { text, selectionStart: at, selectionEnd: at };
}

function draft(chat: string, part: string, current = 0, count = 1): RequestDraft {
  return {
    sessionId: asId<"session">(chat),
    part: asId<"part">(part),
    current,
    fields: Array.from({ length: count }, () => ({
      kind: "single" as const,
      selection: { kind: "option" as const, label: part },
      document: typed(""),
    })),
  };
}

const OWN = ask("own", "q");

const IDLE: Reply = { kind: "idle" };

interface Seen {
  readonly shows?: string | undefined;
  readonly current?: number;
  readonly chosen?: readonly string[];
  readonly text?: string;
  readonly answered?: readonly boolean[];
  readonly reply?: string;
  readonly outcomes?: readonly string[];
  readonly drafts?: readonly string[];
}

const SEEN = [
  "shows",
  "current",
  "chosen",
  "text",
  "answered",
  "reply",
  "outcomes",
  "drafts",
] as const satisfies readonly (keyof Seen)[];

interface Row {
  readonly name: string;
  readonly asks: readonly Ask<OpenQuestion>[];
  readonly drafts?: readonly RequestDraft[];
  readonly reply?: Reply;
  readonly events?: readonly DockEvent[];
  readonly seen: Seen;
}

const ROWS: readonly Row[] = [
  { name: "no asks", asks: [], seen: { shows: undefined } },
  {
    name: "own before a subagent's ask",
    asks: [OWN, ask("agent", "a")],
    seen: { shows: "own/q", current: 0, chosen: [], text: "", answered: [false] },
  },
  {
    name: "the last-touched listed draft wins",
    asks: [OWN, ask("agent", "a"), ask("agent", "b")],
    drafts: [draft("agent", "b"), draft("agent", "a"), draft("gone", "x")],
    seen: { shows: "agent/a", chosen: ["a"] },
  },
  {
    name: "a draft for a request no longer listed is ignored, and dropped by the next step",
    asks: [OWN, ask("agent", "a")],
    drafts: [draft("gone", "x"), draft("agent", "a")],
    events: [{ kind: "select", label: "Yes" }],
    seen: { shows: "agent/a", chosen: ["Yes"], outcomes: ["kept"], drafts: ["agent/a"] },
  },
  {
    name: "single select, then reselect",
    asks: [OWN],
    events: [
      { kind: "select", label: "Yes" },
      { kind: "select", label: "No" },
      { kind: "select", label: "No" },
    ],
    seen: { chosen: ["No"], answered: [true], outcomes: ["kept", "kept", "kept"] },
  },
  {
    name: "typing switches a single choice to its custom answer",
    asks: [OWN],
    events: [
      { kind: "select", label: "Yes" },
      { kind: "document", document: typed("Maybe") },
    ],
    seen: { chosen: [], text: "Maybe", answered: [true], outcomes: ["kept", "kept"] },
  },
  {
    name: "multiple choice toggles",
    asks: [ask("own", "q", ["multiple"])],
    events: [
      { kind: "select", label: "Yes" },
      { kind: "select", label: "No" },
      { kind: "select", label: "Yes" },
    ],
    seen: { chosen: ["No"], outcomes: ["kept", "kept", "kept"] },
  },
  {
    name: "answers are trimmed and de-duplicated, with the custom answer last",
    asks: [ask("own", "q", ["multiple", "single", "single"])],
    events: [
      { kind: "select", label: " Yes" },
      { kind: "select", label: "Yes " },
      { kind: "document", document: typed(" Yes ") },
      { kind: "advance", document: undefined },
      { kind: "document", document: typed("   ") },
      { kind: "advance", document: undefined },
      { kind: "advance", document: undefined },
    ],
    seen: {
      answered: [true, false, false],
      outcomes: ["kept", "kept", "kept", "next", "kept", "next", 'send [["Yes"],[],[]]'],
    },
  },
  {
    name: "a change to the same document does nothing",
    asks: [ask("own", "q", ["multiple"])],
    events: [
      { kind: "document", document: typed("") },
      { kind: "document", document: typed("a") },
      { kind: "document", document: typed("a") },
    ],
    seen: { text: "a", outcomes: ["none", "kept", "none"] },
  },
  {
    name: "a change that keeps a hidden custom box's text does nothing",
    asks: [OWN],
    events: [
      { kind: "select", label: "Yes" },
      { kind: "document", document: typed("", 0) },
      { kind: "document", document: { text: "", selectionStart: 0, selectionEnd: 1 } },
    ],
    seen: { chosen: ["Yes"], text: "", outcomes: ["kept", "none", "none"] },
  },
  {
    name: "advance on a middle field moves to the next field",
    asks: [ask("own", "q", ["single", "single"])],
    events: [
      { kind: "select", label: "Yes" },
      { kind: "advance", document: undefined },
    ],
    seen: { current: 1, answered: [true, false], outcomes: ["kept", "next"] },
  },
  {
    name: "advance on the last field sends every field's answers, the typed document first",
    asks: [ask("own", "q", ["single", "single"])],
    drafts: [draft("own", "q", 1, 2)],
    events: [{ kind: "advance", document: typed("Typed") }],
    seen: {
      current: 1,
      text: "Typed",
      outcomes: ['send [["q"],["Typed"]]'],
      drafts: ["own/q"],
    },
  },
  {
    name: "advance with the shown text keeps the chosen option",
    asks: [OWN],
    events: [
      { kind: "select", label: "No" },
      { kind: "advance", document: typed("") },
    ],
    seen: { chosen: ["No"], outcomes: ["kept", 'send [["No"]]'] },
  },
  {
    name: "dismiss sends no answers and keeps the drafts",
    asks: [OWN],
    events: [{ kind: "dismiss" }],
    seen: { outcomes: ["send null"], drafts: [] },
  },
  {
    name: "while an answer is pending, every action is blocked",
    asks: [OWN],
    reply: { kind: "pending" },
    events: [
      { kind: "select", label: "Yes" },
      { kind: "document", document: typed("x") },
      { kind: "jump", index: 0 },
      { kind: "advance", document: undefined },
      { kind: "dismiss" },
    ],
    seen: {
      reply: "pending",
      chosen: [],
      outcomes: ["blocked", "blocked", "blocked", "blocked", "blocked"],
      drafts: [],
    },
  },
  {
    name: "once this request is sent, its actions are blocked",
    asks: [OWN],
    reply: { kind: "sent", sessionId: OWN.sessionId, part: OWN.request.part },
    events: [{ kind: "advance", document: undefined }, { kind: "dismiss" }],
    seen: { reply: "settled", outcomes: ["blocked", "blocked"] },
  },
  {
    name: "jump stays in range",
    asks: [ask("own", "q", ["single", "single"])],
    events: [
      { kind: "jump", index: 2 },
      { kind: "jump", index: -1 },
      { kind: "jump", index: 1 },
    ],
    seen: { current: 1, outcomes: ["none", "none", "kept"] },
  },
  {
    name: "a sent or failed reply for another request leaves this one open",
    asks: [OWN, ask("agent", "a")],
    reply: { kind: "sent", sessionId: asId<"session">("agent"), part: asId<"part">("a") },
    events: [{ kind: "select", label: "Yes" }],
    seen: { reply: "", outcomes: ["kept"] },
  },
  {
    name: "a failed reply shows only on its request",
    asks: [OWN],
    reply: { kind: "failed", sessionId: OWN.sessionId, part: OWN.request.part, message: "No." },
    events: [{ kind: "select", label: "Yes" }],
    seen: { reply: "error No.", outcomes: ["kept"] },
  },
  {
    name: "a failed reply on another chat's same part is not this one's",
    asks: [OWN],
    reply: {
      kind: "failed",
      sessionId: asId<"session">("agent"),
      part: OWN.request.part,
      message: "No.",
    },
    seen: { reply: "" },
  },
  {
    name: "answered marks each field with an answer",
    asks: [ask("own", "q", ["single", "multiple", "single"])],
    events: [
      { kind: "jump", index: 1 },
      { kind: "document", document: typed("x") },
      { kind: "jump", index: 2 },
      { kind: "select", label: "No" },
    ],
    seen: { current: 2, answered: [false, true, true] },
  },
];

function describe(row: Row): Seen {
  const reply = row.reply ?? IDLE;

  const stepped = (row.events ?? []).reduce<{
    readonly drafts: readonly RequestDraft[];
    readonly outcomes: readonly string[];
  }>(
    (state, event) => {
      const shown = dockView(row.asks, state.drafts, reply);
      assert.ok(shown !== undefined, `${row.name}: nothing shown for ${event.kind}`);
      const step = stepDock(shown, state.drafts, event);

      if (step.outcome.kind === "none" || step.outcome.kind === "blocked")
        assert.equal(step.drafts, state.drafts, `${row.name}: ${event.kind} kept the same drafts`);

      return {
        drafts: step.drafts,
        outcomes: [
          ...state.outcomes,
          step.outcome.kind === "send"
            ? `send ${JSON.stringify(step.outcome.answers)}`
            : step.outcome.kind,
        ],
      };
    },
    { drafts: row.drafts ?? [], outcomes: [] },
  );

  const drafts = stepped.drafts;
  const outcomes = stepped.outcomes;
  const view = dockView(row.asks, drafts, reply);

  return {
    shows: view === undefined ? undefined : `${view.ask.sessionId}/${view.ask.request.part}`,
    current: view?.draft.current,
    chosen: view?.chosen,
    text: view?.document.text,
    answered: view?.answered,
    reply:
      view === undefined
        ? undefined
        : view.pending
          ? "pending"
          : view.settled
            ? "settled"
            : view.error === undefined
              ? ""
              : `error ${view.error}`,
    outcomes,
    drafts: drafts.map((value) => `${value.sessionId}/${value.part}`),
  };
}

test("the question dock shows one request and steps through it", () => {
  for (const row of ROWS) {
    const seen = describe(row);

    assert.deepEqual(
      Object.fromEntries(SEEN.flatMap((key) => (key in row.seen ? [[key, seen[key]]] : []))),
      row.seen,
      row.name,
    );
  }
});
