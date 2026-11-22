import { Renderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { Part, PartDefinition, Renderer } from "@nyte-ai/core";
import type { Json } from "@nyte-ai/schema";
import { isValidElement } from "react";
import { describe, expect, it, onTestFinished } from "vitest";
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
    call: "c1",
    phase: { kind: "asking" },
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

interface Shown {
  readonly isView: boolean;
  readonly text: string;
  readonly press: () => Promise<void>;
}

async function showReact(view: unknown): Promise<Shown> {
  return {
    isView: isValidElement(view),
    text: JSON.stringify(view),
    press: async () => press(view),
  };
}

async function showTerminal(view: unknown): Promise<Shown> {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  onTestFinished(() => setup.dispose());
  const node: unknown = typeof view === "function" ? view(setup.renderer) : null;

  if (!(node instanceof Renderable)) return { isView: false, text: "", press: async () => {} };
  setup.renderer.root.add(node);
  await setup.renderOnce();

  return {
    isView: true,
    text: setup.captureCharFrame(),
    press: async () => {
      for (const leaf of leaves(node)) await setup.mockMouse.click(leaf.x, leaf.y);
    },
  };
}

function leaves(node: Renderable): Renderable[] {
  const children = node.getChildren();

  return children.length === 0 ? [node] : children.flatMap(leaves);
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
    show: showReact,
  },
  {
    framework: "tui",
    renderers: tuiRenderers,
    plugins: [tuiPlugin, tuiQuestions],
    show: showTerminal,
  },
])("$framework renderers", ({ framework, renderers, plugins, show }) => {
  it("render a view for every kind, and an unreadable note for a state the schema rejects", async () => {
    expect(plugins.flatMap((plugin) => plugin.contribute.renderers)).toEqual(renderers);
    expect(renderers.map((renderer) => [renderer.kind.kind, renderer.framework])).toEqual(
      Object.keys(states).map((kind) => [kind, framework]),
    );

    for (const kind of Object.keys(states)) {
      expect((await show(draw(renderers, kind, recorder().act))).isView).toBe(true);
    }

    expect(
      (await show(draw(renderers, "ask/question", recorder().act, { prompt: 1 }))).text,
    ).toContain("cannot be shown");
  });

  it("wire act: a running tool stops", async () => {
    const running = recorder();
    await (await show(draw(renderers, "tool", running.act))).press();

    expect(running.acted).toEqual([{ action: "stop", input: {} }]);
  });
});

it("draws terminal question summaries with descriptions and committed answers", async () => {
  const waiting = recorder();
  const pending = await showTerminal(draw(tuiRenderers, "ask/question", waiting.act));
  await pending.press();
  expect(pending.text).toContain("Yes: Deploy now.");
  expect(waiting.acted).toEqual([]);

  const answered = await showTerminal(
    draw(tuiRenderers, "ask/question", waiting.act, {
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
      call: "c1",
      phase: { kind: "answered", answers: [["After review"], []], head: null },
    }),
  );

  expect(answered.text).toContain("Answer: After review");
  expect(answered.text).toContain("Answer: Unanswered");
});

it("draws the tool part's settled outcome without a stop", async () => {
  const settled = recorder();
  const state = { ...call, phase: "settled", outcome: { kind: "interrupted" }, changes: null };

  press(draw(reactRenderers, "tool", settled.act, state));
  await (await showTerminal(draw(tuiRenderers, "tool", settled.act, state))).press();

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
    call: "c1",
    phase: { kind: "answered", answers: [["No"], ["After review"], []], head: null },
  });

  const rendered = JSON.stringify(answered);

  expect(rendered).toContain("No");
  expect(rendered).toContain("After review");
  expect(rendered).toContain("Unanswered");
  expect(rendered).not.toContain('"type":"input"');
  expect(rendered).not.toContain('"type":"textarea"');
  expect(rendered).not.toContain('"type":"button"');
});
