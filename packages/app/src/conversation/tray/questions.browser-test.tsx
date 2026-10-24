import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { asId, asSeq } from "@nyte-ai/schema";
import type { RunView, SessionView } from "@nyte-ai/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "../../theme/tokens.stylex.ts";
import "../../theme/global.css";
import { installConnection } from "../../sdk.tsx";
import { scriptedConnection } from "../../../test/scripted-connection.ts";
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
  request: { part: asId("part-question"), questions: [field] },
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

const REFUSED = "Pick one of the listed options.";

const UNREACHABLE = "The host is unreachable.";

const ANSWER = "Only if it's open.";

const CONFIGURATION: RunView["configuration"] = {
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
      state: { questions: [field], answers: null },
      version: 1,
      status: { kind: "live", run: asId<"run">("run") },
      owner: "question",
    },
  ],
  turns: [],
  usage: USAGE,
  execution: COMPLETED,
  reportsHeld: false,
  background: [],
  configuration: { selected: CONFIGURATION, effective: CONFIGURATION },
  context: { tokens: 0, window: 1_000, lastRequest: null },
  heads: [],
  changes: [],
  catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
};

installConnection(
  scriptedConnection({
    views: new Map([[SESSION, [asked]]]),
    session: () => ({
      part: (part) => ({
        id: part,
        update: async () => ({ kind: "missing" }),
        act: async () => ({ kind: "rejected", reason: REFUSED }),
        answer: async () => null,
        close: async () => {
          throw new Error(UNREACHABLE);
        },
      }),
    }),
  }).connection,
);

let shown: QuestionDock | undefined;

function AskedTray({
  onAsk,
}: {
  readonly onAsk: (asking: QuestionDock | undefined) => void;
}): ReactElement {
  const asking = useQuestionDock(SESSION);

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

  const failures = await failedReplies();

  return failures.length === 0 ? "passed" : failures.join("\n");
}
