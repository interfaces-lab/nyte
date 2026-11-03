import { Box, Text } from "@opentui/core";
import type { VNode } from "@opentui/core";
import { defineRenderer } from "@nyte-ai/plugin/client";
import type { Plugin, Renderer } from "@nyte-ai/plugin/client";
import { question } from "../schema.ts";

const unreadable = (kind: string): VNode => Text({ content: `This ${kind} part cannot be shown.` });

export const questionRenderers: readonly Renderer[] = [
  defineRenderer(
    question,
    "tui",
    (state) =>
      Box(
        { border: true, title: "Questions", flexDirection: "column" },
        ...state.questions.map((item, index) =>
          Box(
            { flexDirection: "column" },
            Text({ content: `${item.header}: ${item.question}` }),
            ...item.options.map((option) =>
              Text({ content: `${option.label}: ${option.description}` }),
            ),
            ...(state.phase.kind === "answered"
              ? [
                  Text({
                    content: `Answer: ${state.phase.answers[index].join(", ") || "Unanswered"}`,
                  }),
                ]
              : state.phase.kind === "skipped"
                ? [Text({ content: "Skipped" })]
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
