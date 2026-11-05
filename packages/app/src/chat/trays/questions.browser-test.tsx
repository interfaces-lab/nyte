import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { asId, asSeq } from "@nyte-ai/schema";
import type { Configuration, SessionId, SessionView } from "@nyte-ai/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { activeTab, tabPlace } from "../../tabs/model.ts";
import { windowTabs } from "../../tabs/window-tabs.ts";
import "../../theme/tokens.stylex.ts";
import "../../theme/global.css";
import { installScripted, scriptedConnection } from "../../../test/scripted-connection.ts";
import { COMPLETED, USAGE } from "../../../test/view-fixtures.ts";
import { QuestionTray } from "./questions.tsx";
import { QuestionDockContext, useQuestionDock } from "./questions-state.ts";
import type { QuestionDock } from "./questions-state.ts";

const field = {
  question: "Check whether Luigi's Trattoria is open now?",
  header: "Opening hours",
  options: [
    { label: "Yes, check", description: "Look up today's hours." },
    { label: "No", description: "" },
  ],
};

const dock: QuestionDock = {
  request: { part: asId("part-question"), questions: [field], late: false },
  field,
  origin: undefined,
  current: 0,
  total: 1,
  last: true,
  document: { text: "", selectionStart: 0, selectionEnd: 0 },
  pending: false,
  settled: false,
  error: undefined,
  answered: [false],
  isSelected: () => false,
  select: () => undefined,
  changeDocument: () => undefined,
  jump: () => undefined,
  advance: () => Promise.resolve({ kind: "sent" }),
  dismiss: () => Promise.resolve({ kind: "sent" }),
};

const SESSION = asId<"session">("questions");

const TWO_QUESTIONS = asId<"session">("two-questions");

const party = {
  question: "How many people are coming?",
  header: "Party size",
  options: [
    { label: "Two", description: "" },
    { label: "Four", description: "" },
  ],
};

const sent: unknown[] = [];

const REFUSED = "Pick one of the listed options.";

const UNREACHABLE = "The host is unreachable.";

const ANSWER = "Only if it's open.";

const CONFIGURATION: Configuration = {
  kind: "exact",
  model: { provider: "test", id: "test" },
  thinking: "off",
  agent: null,
  settings: {},
  settingsVersion: "1",
};

const asked: SessionView = {
  revision: asId<"revision">("r1"),
  seq: asSeq(1),
  activation: { kind: "active" },
  messages: [],
  queue: [],
  leadingPrompt: null,
  parts: [
    {
      id: asId<"part">("part-question"),
      partKind: "ask/question",
      placement: { kind: "modal" },
      state: { call: "call-question", questions: [field], phase: { kind: "asking" } },
      version: 1,
      status: { kind: "live", run: asId<"run">("run") },
      owner: "question",
    },
  ],
  turns: [],
  usage: USAGE,
  execution: COMPLETED,
  reportsHeld: false,
  seenThrough: null,
  background: [],
  configuration: { selected: CONFIGURATION, effective: CONFIGURATION },
  context: { tokens: 0, window: 1_000, lastRequest: null },
  changes: [],
  catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
};

const askedTwice: SessionView = {
  ...asked,
  parts: [
    {
      id: asId<"part">("part-questions"),
      partKind: "ask/question",
      placement: { kind: "modal" },
      state: { call: "call-questions", questions: [party, field], phase: { kind: "asking" } },
      version: 1,
      status: { kind: "live", run: asId<"run">("run") },
      owner: "question",
    },
  ],
};

installScripted(
  scriptedConnection({
    views: new Map([
      [SESSION, [asked]],
      [TWO_QUESTIONS, [askedTwice]],
    ]),
    session: (id) => ({
      part: (part) => ({
        id: part,
        update: async () => ({ kind: "missing" }),
        act: async (action, input) => {
          if (id === TWO_QUESTIONS) {
            sent.push(input);

            return { kind: "ok", output: undefined };
          }

          if (action === "skip") throw new Error(UNREACHABLE);

          return { kind: "rejected", reason: REFUSED };
        },
        answer: async () => null,
        watch: async function* () {
          yield* [];
        },
        close: async () => undefined,
      }),
    }),
  }),
);

let shown: QuestionDock | undefined;

function AskedTray({
  sessionId,
  onAsk,
}: {
  readonly sessionId: SessionId;
  readonly onAsk: (asking: QuestionDock | undefined) => void;
}): ReactElement {
  const asking = useQuestionDock(sessionId);

  useLayoutEffect(() => onAsk(asking));

  return (
    <QuestionDockContext value={asking}>
      <QuestionTray disabled={false} viewport={null} />
    </QuestionDockContext>
  );
}

async function until<T>(read: () => T | null | undefined, what: string): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    const value = read();

    if (value !== null && value !== undefined) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

async function failedReplies(): Promise<readonly string[]> {
  const host = document.createElement("div");
  host.style.width = "560px";
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <AskedTray
        sessionId={SESSION}
        onAsk={(asking) => {
          shown = asking;
        }}
      />
    </QueryClientProvider>,
  );

  const alert = () => host.querySelector("[role='alert']")?.textContent;

  const answering = await until(() => shown, "the question");

  const answered = await answering.advance({
    text: ANSWER,
    selectionStart: ANSWER.length,
    selectionEnd: ANSWER.length,
  });

  await until(() => (alert() === REFUSED ? true : null), "the refused answer's error");
  const kept = shown?.document.text;
  const dismissing = await until(() => shown, "the question");
  const dismissed = await dismissing.dismiss();

  await until(() => (alert() === UNREACHABLE ? true : null), "the failed dismissal's error");
  root.unmount();
  host.remove();

  return [
    ...(answered.kind === "failed" ? [] : [`a refused answer came back ${answered.kind}`]),
    ...(kept === ANSWER ? [] : [`a refused answer left the answer "${kept ?? ""}"`]),
    ...(dismissed.kind === "failed" ? [] : [`a failed dismissal came back ${dismissed.kind}`]),
  ];
}

function textBox(element: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);

  return range.getBoundingClientRect();
}

function find(selector: string): Element {
  const element = document.querySelector(selector);

  if (element === null) throw new Error(`Missing ${selector}`);

  return element;
}

function measure() {
  const label = find("[data-slot='tray'] [data-slot='questionnaire-description']");
  const title = find("[data-slot='tray'] [data-slot='questionnaire-title']");
  const chevron = find("[data-slot='tray'] button[aria-expanded]").getBoundingClientRect();
  const line = label.getBoundingClientRect();

  return {
    labelLeft: textBox(label).left,
    titleLeft: textBox(title).left,
    labelCentre: line.top + line.height / 2,
    chevronCentre: chevron.top + chevron.height / 2,
  };
}

declare global {
  interface Window {
    readonly rendererMouseClick: (payload: string) => void;
    readonly rendererKey: (payload: string) => void;
  }
}

const KEYS = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  two: { key: "2", code: "Digit2", keyCode: 50, text: "2" },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
};

const META = 4;

async function press(stroke: (typeof KEYS)[keyof typeof KEYS], modifiers = 0): Promise<void> {
  await new Promise<void>((resolve) => {
    document.addEventListener("renderer-key-pressed", () => resolve(), { once: true });
    window.rendererKey(JSON.stringify({ ...stroke, modifiers }));
  });
}

async function click(element: Element): Promise<void> {
  const box = element.getBoundingClientRect();

  await new Promise<void>((resolve) => {
    document.addEventListener("renderer-mouse-clicked", () => resolve(), { once: true });
    window.rendererMouseClick(
      JSON.stringify({ x: box.left + box.width / 2, y: box.top + box.height / 2, shift: false }),
    );
  });
}

const CHOICE = "[data-slot='questionnaire-choice']";

function within(host: Element, selector: string, label: string): HTMLElement {
  const element = Array.from(host.querySelectorAll<HTMLElement>(selector)).find((candidate) =>
    candidate.textContent.includes(label),
  );

  if (element === undefined) throw new Error(`Missing ${selector} "${label}"`);

  return element;
}

function radio(host: Element, label: string): HTMLInputElement {
  const input = within(host, CHOICE, label).querySelector("input");

  if (input === null) throw new Error(`Missing the input of "${label}"`);

  return input;
}

/** Answers the first of two questions with Four and Next, then runs `step` on the second. */
async function secondQuestion(step: (host: HTMLElement) => Promise<void>) {
  sent.length = 0;
  const host = document.createElement("div");
  host.style.width = "560px";
  document.body.append(host);
  const root = createRoot(host);
  let asking: QuestionDock | undefined;
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <AskedTray
        sessionId={TWO_QUESTIONS}
        onAsk={(next) => {
          asking = next;
        }}
      />
    </QueryClientProvider>,
  );

  await until(() => asking, "the two questions");
  await click(within(host, CHOICE, "Four"));
  await click(within(host, "button", "Next"));
  await until(() => (asking?.current === 1 ? true : null), "the second question");
  await step(host);
  await new Promise((resolve) => setTimeout(resolve, 150));

  const outcome = {
    sent: JSON.stringify(sent),
    question: asking?.current,
    chosen: asking?.field.options
      .filter((option) => asking?.isSelected(option.label) === true)
      .map((option) => option.label)
      .join(", "),
  };

  root.unmount();
  host.remove();

  return outcome;
}

const NOTHING = JSON.stringify([]);

const BOTH = JSON.stringify([{ answers: [["Four"], ["No"]] }]);

const DISMISSED = JSON.stringify([{}]);

/** Choosing an answer only selects it, Enter on a chosen answer goes to the next question, and only Submit or Cmd+Enter sends. */
async function lastAnswer(): Promise<readonly string[]> {
  const chooseNo = (host: HTMLElement) => click(within(host, CHOICE, "No"));

  const pressOn =
    (label: string, key: (typeof KEYS)[keyof typeof KEYS], modifiers = 0) =>
    async (host: HTMLElement) => {
      radio(host, label).focus();
      await press(key, modifiers);
    };

  const journeys: readonly {
    readonly name: string;
    readonly step: (host: HTMLElement) => Promise<void>;
    readonly sends: string;
    readonly question: number;
    readonly chosen: string;
  }[] = [
    { name: "a click on No", step: chooseNo, sends: NOTHING, question: 1, chosen: "No" },
    {
      name: "the 2 key",
      step: pressOn("Yes, check", KEYS.two),
      sends: NOTHING,
      question: 1,
      chosen: "No",
    },
    {
      name: "ArrowDown",
      step: pressOn("Yes, check", KEYS.down),
      sends: NOTHING,
      question: 1,
      chosen: "No",
    },
    { name: "Space", step: pressOn("No", KEYS.space), sends: NOTHING, question: 1, chosen: "No" },
    {
      name: "Enter on the chosen No",
      step: async (host) => {
        await chooseNo(host);
        await pressOn("No", KEYS.enter)(host);
      },
      sends: NOTHING,
      question: 1,
      chosen: "No",
    },
    {
      name: "Back, then Enter on the chosen Four",
      step: async (host) => {
        await click(within(host, "button", "Back"));
        await pressOn("Four", KEYS.enter)(host);
      },
      sends: NOTHING,
      question: 1,
      chosen: "",
    },
    {
      name: "Submit",
      step: async (host) => {
        await chooseNo(host);
        await click(within(host, "button", "Submit"));
      },
      sends: BOTH,
      question: 1,
      chosen: "No",
    },
    {
      name: "Cmd+Enter",
      step: async (host) => {
        await chooseNo(host);
        await pressOn("No", KEYS.enter, META)(host);
      },
      sends: BOTH,
      question: 1,
      chosen: "No",
    },
    {
      name: "Escape",
      step: pressOn("No", KEYS.escape),
      sends: DISMISSED,
      question: 1,
      chosen: "",
    },
  ];

  const failures: string[] = [];

  for (const journey of journeys) {
    const outcome = await secondQuestion(journey.step);

    if (outcome.sent !== journey.sends)
      failures.push(`${journey.name} sent ${outcome.sent}, expected ${journey.sends}`);

    if (outcome.question !== journey.question || outcome.chosen !== journey.chosen)
      failures.push(
        `${journey.name} showed question ${String(outcome.question)} with "${outcome.chosen ?? ""}" chosen, expected question ${String(journey.question)} with "${journey.chosen}"`,
      );
  }

  return failures;
}

async function askers(): Promise<readonly string[]> {
  const host = document.createElement("div");
  host.style.width = "560px";
  document.body.append(host);
  const root = createRoot(host);
  const origin = { title: "Tray review", sessionId: asId<"session">("tray-review") };

  const cases = [
    { origin: undefined, late: false, attribution: "Asked by this chat", continuation: undefined },
    {
      origin: undefined,
      late: true,
      attribution: "Asked by this chat",
      continuation: "This chat kept going. You can still answer.",
    },
    { origin, late: false, attribution: "Asked by Open Tray review chat", continuation: undefined },
    {
      origin,
      late: true,
      attribution: "Asked by Open Tray review chat",
      continuation: "Tray review kept going. You can still answer.",
    },
  ];

  const failures: string[] = [];
  windowTabs.start({ id: "question-askers", launch: undefined });
  windowTabs.openChat(SESSION, "permanent");
  const parent = activeTab(windowTabs.getSnapshot());

  for (const theme of ["light", "dark"] as const) {
    applyDisplayMode(theme);

    for (const entry of cases) {
      flushSync(() =>
        root.render(
          <QuestionDockContext
            value={{
              ...dock,
              origin: entry.origin,
              request: { ...dock.request, late: entry.late },
            }}
          >
            <QuestionTray disabled={false} viewport={null} />
          </QuestionDockContext>,
        ),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const descriptions = Array.from(
        host.querySelectorAll("[data-slot='questionnaire-description']"),
        (element) => element.textContent,
      );

      const expected = [
        "Question",
        entry.attribution,
        ...(entry.continuation ? [entry.continuation] : []),
      ];

      if (JSON.stringify(descriptions) !== JSON.stringify(expected))
        failures.push(
          `${theme}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(descriptions)}`,
        );

      const opener = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Open Tray review chat",
      );

      if (entry.origin === undefined) {
        if (opener !== undefined) failures.push(`${theme}: this chat has a subagent action`);
        continue;
      }

      if (opener === undefined) {
        failures.push(`${theme}: the subagent's name cannot open its chat`);
        continue;
      }

      await click(opener);
      const state = windowTabs.getSnapshot();
      const child = activeTab(state);
      const place = tabPlace(child);

      if (
        place.kind !== "session" ||
        place.sessionId !== origin.sessionId ||
        state.tabs.indexOf(child) !== state.tabs.indexOf(parent) + 1 ||
        child.view.kind !== "preview" ||
        opener.type !== "button"
      )
        failures.push(`${theme}: the name did not open the child's chat next to its parent`);

      windowTabs.dispatch({ kind: "close-tab", tabId: child.id });
    }
  }

  root.unmount();
  host.remove();

  return failures;
}

export async function mount(): Promise<void> {
  const host = document.createElement("div");
  host.style.width = "560px";
  host.style.padding = "24px";
  document.body.append(host);
  createRoot(host).render(
    <QuestionDockContext value={dock}>
      <QuestionTray disabled={false} viewport={null} />
    </QuestionDockContext>,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
}

export async function show(theme: "light" | "dark") {
  applyDisplayMode(theme);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  return measure();
}

export async function run(): Promise<string> {
  await mount();

  for (const theme of ["light", "dark"] as const) {
    const { labelLeft, titleLeft, labelCentre, chevronCentre } = await show(theme);

    if (labelLeft !== titleLeft)
      return `${theme}: the label starts at ${String(labelLeft)}, the title at ${String(titleLeft)}`;

    if (Math.abs(labelCentre - chevronCentre) > 0.5)
      return `${theme}: the chevron's centre ${String(chevronCentre)} is off the label's ${String(labelCentre)}`;
  }

  const failures = [...(await failedReplies()), ...(await lastAnswer()), ...(await askers())];

  return failures.length === 0 ? "passed" : failures.join("\n");
}
