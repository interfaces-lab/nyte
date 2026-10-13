import { isVNode } from "@opentui/core";
import type { Part, PartDefinition, Renderer } from "@nyte-ai/core";
import type { Json } from "@nyte-ai/schema";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import reactPlugin, { reactRenderers } from "../src/renderers/react.tsx";
import tuiPlugin, { tuiRenderers } from "../src/renderers/tui.ts";

const call = {
  call: "c1",
  name: "bash",
  args: { command: "ls" },
  class: { kind: "shell", command: "ls" },
};

/** One valid state per kind the renderers draw. */
const states: Readonly<Record<string, Json>> = {
  text: { markdown: "Hello.", signature: null },
  thinking: { markdown: "Hmm.", merged: 1, signature: null },
  tool: { ...call, phase: "running", progress: null },
  compaction: { summary: "Earlier work.", material: null, tokensBefore: 90_000, usage: null },
  branchSummary: { markdown: "Tried another parser." },
  "ask/question": { prompt: "Deploy?", options: ["yes", "no"], answer: null },
};

/** Returns an `act` that records each call and answers closed. */
function recorder() {
  const acted: { readonly action: string; readonly input: unknown }[] = [];

  const act: Part<PartDefinition>["act"] = async (action, input) => {
    acted.push({ action, input });

    return { kind: "closed" };
  };

  return { acted, act };
}

/** Calls every `onClick` and `onMouseDown` handler in a React element or OpenTUI node tree. */
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

/** Renders a kind's sample state through the renderer for it. */
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
    plugin: reactPlugin,
    isView: (value: unknown) => isValidElement(value),
  },
  {
    framework: "tui",
    renderers: tuiRenderers,
    plugin: tuiPlugin,
    isView: (value: unknown) => isVNode(value),
  },
])("$framework renderers", ({ framework, renderers, plugin, isView }) => {
  it("render a view for every kind, and an unreadable note for a state the schema rejects", () => {
    expect(plugin.contribute.renderers).toBe(renderers);
    expect(renderers.map((renderer) => [renderer.kind.kind, renderer.framework])).toEqual(
      Object.keys(states).map((kind) => [kind, framework]),
    );

    for (const kind of Object.keys(states))
      expect(isView(draw(renderers, kind, recorder().act))).toBe(true);

    expect(
      JSON.stringify(draw(renderers, "ask/question", recorder().act, { prompt: 1 })),
    ).toContain("cannot be shown");
  });

  it("wire act: a question's choices answer it, a running tool stops", () => {
    const question = recorder();
    press(draw(renderers, "ask/question", question.act));

    expect(question.acted).toEqual([
      { action: "answer", input: { choice: "yes" } },
      { action: "answer", input: { choice: "no" } },
    ]);

    const running = recorder();
    press(draw(renderers, "tool", running.act));

    expect(running.acted).toEqual([{ action: "stop", input: {} }]);
  });
});

it("draws the tool part's settled outcome without a stop", () => {
  const settled = recorder();
  const state = { ...call, phase: "settled", outcome: { kind: "interrupted" }, changes: null };

  press(draw(reactRenderers, "tool", settled.act, state));
  press(draw(tuiRenderers, "tool", settled.act, state));

  expect(settled.acted).toEqual([]);
});
