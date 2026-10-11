import { branchSummary, compaction, text, thinking, tool } from "@nyte-ai/core";
import type { Renderer } from "@nyte-ai/core";
import type { ReactNode } from "react";
import type { Plugin } from "../client.ts";
import { question } from "../question.ts";
import { view } from "./view.ts";

/** Returns what a part whose state fails its schema draws. */
const unreadable = (kind: string): ReactNode => (
  <div data-part={kind}>This {kind} part cannot be shown.</div>
);

/**
 * Renderers for React clients, the desktop and the web: the five built-in
 * part kinds and `ask/question`. Each draws a part's state; the tool's Stop
 * and the question's choices call `act`.
 *
 * @category plugins
 * @since 0.1.0
 */
export const reactRenderers: readonly Renderer[] = [
  view(text, "react", (state) => <div data-part="text">{state.markdown}</div>, unreadable),
  view(
    thinking,
    "react",
    (state) => (
      <details data-part="thinking">
        <summary>Thinking</summary>
        {state.markdown}
      </details>
    ),
    unreadable,
  ),
  view(
    tool,
    "react",
    (state, act) => (
      <div data-part="tool" data-phase={state.phase}>
        <span>{state.class.kind === "custom" ? state.class.label : state.name}</span>
        {state.phase === "settled" ? (
          <span>{state.outcome.kind}</span>
        ) : (
          <button onClick={() => void act("stop", {})}>Stop</button>
        )}
      </div>
    ),
    unreadable,
  ),
  view(
    compaction,
    "react",
    (state) => (
      <div data-part="compaction">
        {state.summary ?? `Context compacted at ${state.tokensBefore} tokens.`}
      </div>
    ),
    unreadable,
  ),
  view(
    branchSummary,
    "react",
    (state) => <div data-part="branchSummary">{state.markdown}</div>,
    unreadable,
  ),
  view(
    question,
    "react",
    (state, act) => (
      <div data-part="ask/question" role="dialog" aria-label={state.prompt}>
        <p>{state.prompt}</p>
        {state.options.map((choice) => (
          <button key={choice} onClick={() => void act("answer", { choice })}>
            {choice}
          </button>
        ))}
      </div>
    ),
    unreadable,
  ),
];

/**
 * The React renderers as a client plugin.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "renderers-react",
  contribute: { renderers: reactRenderers },
} satisfies Plugin;
