import { Box, Text } from "@opentui/core";
import type { VNode } from "@opentui/core";
import { branchSummary, compaction, text, thinking, tool } from "@nyte-ai/plugin/client";
import type { Renderer } from "@nyte-ai/plugin/client";
import type { Plugin } from "@nyte-ai/plugin/client";
import { defineRenderer } from "@nyte-ai/plugin/client";

const unreadable = (): VNode | null => null;

/**
 * Renderers for the terminal client, as OpenTUI nodes: the five built-in
 * part kinds. Feature plugins contribute their own renderers. A state its
 * schema rejects draws nothing, for the client to show raw.
 *
 * @category plugins
 * @since 0.1.0
 */
export const transcriptRenderers: readonly Renderer[] = [
  defineRenderer(text, "tui", (state) => Text({ content: state.markdown }), unreadable),
  defineRenderer(
    thinking,
    "tui",
    (state) => Text({ content: `Thinking: ${state.markdown}` }),
    unreadable,
  ),
  defineRenderer(
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
  defineRenderer(
    compaction,
    "tui",
    (state) =>
      Text({ content: state.summary ?? `Context compacted at ${state.tokensBefore} tokens.` }),
    unreadable,
  ),
  defineRenderer(
    branchSummary,
    "tui",
    (state) => Text({ content: `Branch summary: ${state.markdown}` }),
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
  id: "transcript-tui",
  contribute: { renderers: transcriptRenderers },
} satisfies Plugin;
