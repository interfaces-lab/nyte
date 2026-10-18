import { branchSummary, compaction, text, thinking, tool } from "@nyte-ai/plugin/client";
import type { Renderer } from "@nyte-ai/plugin/client";
import type { ReactNode } from "react";
import type { Plugin } from "@nyte-ai/plugin/client";
import { defineRenderer } from "@nyte-ai/plugin/client";

const unreadable = (): ReactNode => null;

/**
 * Renderers for React clients, the desktop and the web: the five built-in
 * part kinds. The tool's Stop action calls `act`. A state its schema rejects
 * draws nothing, for the client to show raw.
 *
 * @category plugins
 * @since 0.1.0
 */
export const transcriptRenderers: readonly Renderer[] = [
  defineRenderer(
    text,
    "react",
    (state) => <div data-part="text">{state.markdown}</div>,
    unreadable,
  ),
  defineRenderer(
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
  defineRenderer(
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
  defineRenderer(
    compaction,
    "react",
    (state) => (
      <div data-part="compaction">
        {state.summary ?? `Context compacted at ${state.tokensBefore} tokens.`}
      </div>
    ),
    unreadable,
  ),
  defineRenderer(
    branchSummary,
    "react",
    (state) => <div data-part="branchSummary">{state.markdown}</div>,
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
  id: "transcript",
  contribute: { renderers: transcriptRenderers },
} satisfies Plugin;
