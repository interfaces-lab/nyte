import {
  PROMPT,
  STOPPED,
  type Section,
  TEST_OUTPUT,
  TYPE_ERRORS,
  call,
  custom,
  edited,
  failed,
  list,
  ok,
  read,
  said,
  shell,
  thought,
  turn,
  user,
} from "../build";

export const episodesSection: Section = {
  id: "episodes",
  title: "Work episodes",
  detail:
    "Reasoning and tool calls between two pieces of prose form one StepGroupView. Density decides whether it opens.",
  specimens: [
    {
      id: "thought-titled",
      title: "One thought with a heading",
      source: 'thinking only · "**Heading**" titles the group',
      scene: {
        turns: [
          turn([
            user(PROMPT),
            thought(
              "**Weighing the grouping rule**\n\nPlacement has to follow `kind` alone. Anything that reads length or position moves prose under the reader when the next part lands.",
              0,
            ),
            said("Grouping stays keyed on kind.", 9),
          ]),
        ],
      },
    },
    {
      id: "thoughts",
      title: "Several thoughts",
      source: "thinking × 2",
      scene: {
        turns: [
          turn([
            user(PROMPT),
            thought(
              "**Reading the presentation**\n\nThe summary counts files by set, so a file read twice counts once.",
              0,
            ),
            thought("**Checking failures**\n\nA failed call must not claim a verb.", 4),
            said("Both rules already hold.", 7),
          ]),
        ],
      },
    },
    {
      id: "episode-edit",
      title: "Edited, explored and ran",
      source: "thinking · read · list · shell · edit",
      scene: {
        turns: [
          turn([
            user(PROMPT),
            thought("**Finding the summary**\n\nThe verb is chosen in `settledSummary`.", 1),
            call(list("packages/app/src/conversation"), ok(), 2),
            call(read("packages/app/src/conversation/step-group-presentation.ts"), ok(), 3),
            call(read("packages/app/src/conversation/step-group-content.ts"), ok(), 4),
            call(edited, ok(), 9),
            call(shell("pnpm --dir packages/app test step-group"), ok(), 21, TEST_OUTPUT),
            said("The compact preview now wraps instead of overflowing.", 24),
          ]),
        ],
      },
    },
    {
      id: "episode-explore",
      title: "Explored only",
      source: "read × 2 · list",
      scene: {
        turns: [
          turn([
            user("Where is tool call density read?"),
            call(list("packages/app/src/preferences"), ok(), 1),
            call(read("packages/app/src/preferences/index.ts"), ok(), 2),
            call(read("packages/app/src/conversation/timeline.tsx"), ok(), 3),
            said("`preferences.toolCalls`, read in `timeline.tsx`.", 5),
          ]),
        ],
      },
    },
    {
      id: "episode-trouble",
      title: "Episode with a failure",
      source: "ok + failed · no verb claimed",
      scene: {
        turns: [
          turn([
            user("Typecheck the lab."),
            call(read("packages/lab/src/router.tsx"), ok(), 1),
            call(shell("pnpm --dir packages/lab typecheck"), failed(TYPE_ERRORS), 14),
            said("Two call sites still need `density`.", 16),
          ]),
        ],
      },
    },
    {
      id: "episode-lost",
      title: "Every call failed or stopped",
      source: "failed × 2 · stopped",
      scene: {
        turns: [
          turn([
            user("Run the e2e suite."),
            call(shell("pnpm --dir packages/app e2e"), failed("Timed out after 120s."), 1),
            call(custom("websearch"), failed("Search provider returned 503."), 2),
            call(shell("pnpm --dir packages/desktop build"), STOPPED, 3),
          ]),
        ],
      },
    },
    {
      id: "episode-split",
      title: "Prose between two episodes",
      source: "step · response · step · response",
      scene: {
        turns: [
          turn([
            user(PROMPT),
            call(read("packages/app/src/conversation/turn-view.tsx"), ok(), 1),
            call(read("packages/app/src/conversation/live-turn.tsx"), ok(), 2),
            said("Both read the density themselves. Moving it to a prop.", 4),
            call(edited, ok(), 8),
            call(shell("pnpm --dir packages/app typecheck"), ok(), 30),
            said("Typecheck passes.", 31),
          ]),
        ],
      },
    },
  ],
};
