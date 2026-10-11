import { Box, Text } from "@opentui/core";
import type { VNode } from "@opentui/core";
import { branchSummary, compaction, text, thinking, tool } from "@nyte-ai/core";
import type { Renderer } from "@nyte-ai/core";
import type { Plugin } from "../client.ts";
import { question } from "../question.ts";
import { view } from "./view.ts";

/** Returns what a part whose state fails its schema draws. */
const unreadable = (kind: string): VNode => Text({ content: `This ${kind} part cannot be shown.` });

/**
 * Renderers for the terminal client, as OpenTUI nodes: the five built-in
 * part kinds and `ask/question`. A click on a question's choice answers it.
 *
 * @category plugins
 * @since 0.1.0
 */
export const tuiRenderers: readonly Renderer[] = [
  view(text, "tui", (state) => Text({ content: state.markdown }), unreadable),
  view(thinking, "tui", (state) => Text({ content: `Thinking: ${state.markdown}` }), unreadable),
  view(
    tool,
    "tui",
    (state, act) =>
      Box(
        { flexDirection: "row", gap: 1 },
        Text({ content: state.class.kind === "custom" ? state.class.label : state.name }),
        state.phase === "settled"
          ? Text({ content: state.outcome.kind })
          : Text({ content: "[stop]", onMouseDown: () => void act("stop", {}) }),
      ),
    unreadable,
  ),
  view(
    compaction,
    "tui",
    (state) =>
      Text({ content: state.summary ?? `Context compacted at ${state.tokensBefore} tokens.` }),
    unreadable,
  ),
  view(
    branchSummary,
    "tui",
    (state) => Text({ content: `Branch summary: ${state.markdown}` }),
    unreadable,
  ),
  view(
    question,
    "tui",
    (state, act) =>
      Box(
        { border: true, title: state.prompt, flexDirection: "column" },
        ...state.options.map((choice, index) =>
          Text({
            content: `${index + 1}. ${choice}`,
            onMouseDown: () => void act("answer", { choice }),
          }),
        ),
      ),
    unreadable,
  ),
];

/**
 * The terminal renderers as a client plugin.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "renderers-tui",
  contribute: { renderers: tuiRenderers },
} satisfies Plugin;
