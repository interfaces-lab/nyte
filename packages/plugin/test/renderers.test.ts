import { isVNode } from "@opentui/core";
import type { Part, PartDefinition, Renderer } from "@nyte-ai/core";
import type { Json } from "@nyte-ai/schema";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import reactPlugin, { transcriptRenderers as reactTranscript } from "../src/client/transcript.tsx";
import tuiPlugin, { transcriptRenderers as tuiTranscript } from "../src/client/transcript-tui.ts";

import reactQuestions, {
  questionRenderers as reactQuestionViews,
} from "../src/question/client/questions.tsx";
import tuiQuestions, {
  questionRenderers as tuiQuestionViews,
} from "../src/question/client/questions-tui.ts";

const reactRenderers = [...reactTranscript, ...reactQuestionViews];
const tuiRenderers = [...tuiTranscript, ...tuiQuestionViews];

const call = {
  call: "c1",
  name: "bash",
  args: { command: "ls" },
  class: { kind: "shell", command: "ls" },
};

const states: Readonly<Record<string, Json>> = {
  text: { markdown: "Hello.", signature: null },
  thinking: { markdown: "Hmm.", merged: 1, signature: null },
  tool: { ...call, phase: "running", progress: null },
  compaction: { summary: "Earlier work.", material: null, tokensBefore: 90_000, usage: null },
  branchSummary: { markdown: "Tried another parser." },
  "ask/question": {
    questions: [
      {
        question: "Deploy?",
        header: "Deployment",
        options: [
          { label: "Yes", description: "Deploy now." },
          { label: "No", description: "Keep reviewing." },
        ],
      },
    ],
    answers: null,
  },
};

function recorder() {
  const acted: { readonly action: string; readonly input: unknown }[] = [];

  const act: Part<PartDefinition>["act"] = async (action, input) => {
    acted.push({ action, input });

    return { kind: "closed" };
  };

  return { acted, act };
}

function press(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) press(child);

    return;
  }

  if (typeof node !== "object" || node === null) return;
  const props = "props" in node ? node.props : null;

  if (typeof props === "object" && props !== null) {
    if ("onClick" in props && typeof props.onClick === "function") props.onClick();

    if ("onMouseDown" in props && typeof props.onMouseDown === "function") props.onMouseDown();

    if ("children" in props) press(props.children);
  }

  if ("children" in node) press(node.children);
}

function draw(
  renderers: readonly Renderer[],
  kind: string,
  act: Part<PartDefinition>["act"],
  state: Json | undefined = states[kind],
): unknown {
  const renderer = renderers.find((candidate) => candidate.kind.kind === kind);

  if (renderer === undefined) throw new Error(`No renderer for ${kind}.`);

  return renderer.render(
    { state, version: 1, placement: { kind: "transcript", role: "answer" } },
    act,
  );
}

describe.each([
  {
    framework: "react",
    renderers: reactRenderers,
    plugins: [reactPlugin, reactQuestions],
    isView: (value: unknown) => isValidElement(value),
  },
  {
    framework: "tui",
    renderers: tuiRenderers,
    plugins: [tuiPlugin, tuiQuestions],
    isView: (value: unknown) => isVNode(value),
  },
])("$framework renderers", ({ framework, renderers, plugins, isView }) => {
  it("render a view for every kind, and an unreadable note for a state the schema rejects", () => {
    expect(plugins.flatMap((plugin) => plugin.contribute.renderers)).toEqual(renderers);
    expect(renderers.map((renderer) => [renderer.kind.kind, renderer.framework])).toEqual(
      Object.keys(states).map((kind) => [kind, framework]),
    );

    for (const kind of Object.keys(states))
      expect(isView(draw(renderers, kind, recorder().act))).toBe(true);

    expect(
      JSON.stringify(draw(renderers, "ask/question", recorder().act, { prompt: 1 })),
    ).toContain("cannot be shown");
  });

  it("wire act: a running tool stops", () => {
    const running = recorder();
    press(draw(renderers, "tool", running.act));

    expect(running.acted).toEqual([{ action: "stop", input: {} }]);
  });
});

it("draws terminal question summaries with descriptions and committed answers", () => {
  const waiting = recorder();
  const pending = draw(tuiRenderers, "ask/question", waiting.act);
  press(pending);
  expect(JSON.stringify(pending)).toContain("Yes: Deploy now.");
  expect(waiting.acted).toEqual([]);

  const answered = draw(tuiRenderers, "ask/question", waiting.act, {
    questions: [
      {
        question: "Deploy?",
        header: "Deployment",
        options: [{ label: "Yes", description: "Deploy now." }],
      },
      {
        question: "When?",
        header: "Timing",
        options: [{ label: "Today", description: "Ship today." }],
      },
    ],
    answers: [["After review"], []],
  });

  expect(JSON.stringify(answered)).toContain("Answer: After review");
  expect(JSON.stringify(answered)).toContain("Answer: Unanswered");
});

it("draws the tool part's settled outcome without a stop", () => {
  const settled = recorder();
  const state = { ...call, phase: "settled", outcome: { kind: "interrupted" }, changes: null };

  press(draw(reactRenderers, "tool", settled.act, state));
  press(draw(tuiRenderers, "tool", settled.act, state));

  expect(settled.acted).toEqual([]);
});

it("draws committed React answers without stale draft controls", () => {
  const answered = draw(reactRenderers, "ask/question", recorder().act, {
    questions: [
      {
        header: "Deployment",
        question: "Deploy?",
        options: [
          { label: "Yes", description: "Deploy now." },
          { label: "No", description: "Keep reviewing." },
        ],
      },
      { header: "Timing", question: "When?", options: [] },
      { header: "Scope", question: "What should change?", options: [] },
    ],
    answers: [["No"], ["After review"], []],
  });

  const rendered = JSON.stringify(answered);

  expect(rendered).toContain("No");
  expect(rendered).toContain("After review");
  expect(rendered).toContain("Unanswered");
  expect(rendered).not.toContain('"type":"input"');
  expect(rendered).not.toContain('"type":"textarea"');
  expect(rendered).not.toContain('"type":"button"');
});
