import {
  CWD,
  MARKDOWN,
  PROMPT,
  SWATCH,
  type Section,
  action,
  lines,
  said,
  turn,
  user,
} from "../build";

export const messagesSection: Section = {
  id: "messages",
  title: "Messages",
  detail: "User messages and the assistant's text. Density changes none of these.",
  specimens: [
    {
      id: "user-text",
      title: "User message",
      source: 'kind = "user" · content: string',
      scene: { turns: [turn([user(PROMPT)])] },
    },
    {
      id: "user-long",
      title: "Long user message",
      source: 'kind = "user" · clipped at 3.5 lines',
      scene: {
        turns: [
          turn([
            user(
              lines(
                "The step group summary should say what happened, not what the tools were called.",
                "",
                "When an episode edits one file, name the file. When it reads several, count them. A call that failed or stopped should never claim a verb: each tally says what became of it.",
                "",
                "Keep reasoning out of the summary unless it is the only thing in the group, and fold settled reasoning to its title in detailed mode.",
                "",
                "Then check every density: compact, balanced and detailed.",
              ),
            ),
          ]),
        ],
      },
    },
    {
      id: "user-images",
      title: "User message with images",
      source: "content: (text | file)[]",
      scene: {
        turns: [
          turn([
            user([
              { kind: "file", blob: SWATCH, mime: "image/svg+xml", name: "warm.svg" },
              { kind: "file", blob: SWATCH, mime: "image/svg+xml", name: "cool.svg" },
              { kind: "text", text: "Match these two swatches in the accent ramp." },
            ]),
          ]),
        ],
      },
    },
    {
      id: "user-references",
      title: "User message with references",
      source: "content: string · file URL and skill sentence",
      scene: {
        turns: [
          turn([
            user(
              `Use the unslop skill.\n\nRewrite the hint in @file://${CWD}/packages/app/src/settings/appearance.tsx so it fits one line.`,
            ),
          ]),
        ],
      },
    },
    {
      id: "user-action",
      title: "Action message",
      source: 'part.source = { kind: "action", label }',
      scene: {
        turns: [
          turn([
            action(
              "Review uncommitted changes",
              "Review the uncommitted changes in this workspace and report anything that would break the build.",
            ),
          ]),
        ],
      },
    },
    {
      id: "assistant-prose",
      title: "Assistant prose",
      source: 'partKind = "text" · markdown',
      scene: { turns: [turn([user(PROMPT), said(MARKDOWN, 8)])] },
    },
    {
      id: "assistant-parts",
      title: "Response in several parts",
      source: "consecutive text parts → one ResponseView",
      scene: {
        turns: [
          turn([
            user(PROMPT),
            said("The settled summary now leads with the outcome.", 6),
            said("Failed and stopped calls are tallied instead of claiming a verb.", 6),
          ]),
        ],
      },
    },
  ],
};
