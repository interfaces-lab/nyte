import { defineRenderer } from "@nyte-ai/plugin/client";
import type { Plugin, Renderer } from "@nyte-ai/plugin/client";
import { box, text } from "../../client/tui-view.ts";
import type { TuiView } from "../../client/tui-view.ts";
import { question } from "../schema.ts";

const unreadable = (kind: string): TuiView =>
  text({ content: `This ${kind} part cannot be shown.` });

export const questionRenderers: readonly Renderer[] = [
  defineRenderer(
    question,
    "tui",
    (state) =>
      box(
        { border: true, title: "Questions", flexDirection: "column" },
        ...state.questions.map((item, index) =>
          box(
            { flexDirection: "column" },
            text({ content: `${item.header}: ${item.question}` }),
            ...item.options.map((option) =>
              text({ content: `${option.label}: ${option.description}` }),
            ),
            ...(state.phase.kind === "answered"
              ? [
                  text({
                    content: `Answer: ${state.phase.answers[index].join(", ") || "Unanswered"}`,
                  }),
                ]
              : state.phase.kind === "skipped"
                ? [text({ content: "Skipped" })]
                : []),
          ),
        ),
      ),
    unreadable,
  ),
];

export default {
  id: "questions-tui",
  contribute: { renderers: questionRenderers },
} satisfies Plugin;
