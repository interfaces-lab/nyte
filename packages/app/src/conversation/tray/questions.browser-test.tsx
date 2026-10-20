import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { asId } from "@nyte-ai/schema";
import { createRoot } from "react-dom/client";
import "../../theme/tokens.stylex.ts";
import "../../theme/global.css";
import { QuestionTray } from "./questions.tsx";
import { QuestionDockContext } from "./questions-state.ts";
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
  advance: () => Promise.resolve(),
  dismiss: () => Promise.resolve(),
};

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

  return "passed";
}
