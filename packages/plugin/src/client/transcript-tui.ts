import {
  branchSummary,
  compaction,
  text,
  thinking,
  tool,
  defineRenderer,
} from "@nyte-ai/plugin/client";
import type { Renderer, Plugin } from "@nyte-ai/plugin/client";
import { box, text as textView } from "./tui-view.ts";
import type { TuiView } from "./tui-view.ts";

const unreadable = (): TuiView | null => null;

export const transcriptRenderers: readonly Renderer[] = [
  defineRenderer(text, "tui", (state) => textView({ content: state.markdown }), unreadable),
  defineRenderer(
    thinking,
    "tui",
    (state) => textView({ content: `Thinking: ${state.markdown}` }),
    unreadable,
  ),
  defineRenderer(
    tool,
    "tui",
    (state, act) =>
      box(
        { flexDirection: "row", gap: 1 },
        textView({ content: state.class.kind === "custom" ? state.class.label : state.name }),
        state.phase === "settled"
          ? textView({ content: state.outcome.kind })
          : textView({ content: "[stop]", onMouseDown: () => void act("stop", {}) }),
      ),
    unreadable,
  ),
  defineRenderer(
    compaction,
    "tui",
    (state) =>
      textView({ content: state.summary ?? `Context compacted at ${state.tokensBefore} tokens.` }),
    unreadable,
  ),
  defineRenderer(
    branchSummary,
    "tui",
    (state) => textView({ content: `Branch summary: ${state.markdown}` }),
    unreadable,
  ),
];

export default {
  id: "transcript-tui",
  contribute: { renderers: transcriptRenderers },
} satisfies Plugin;
