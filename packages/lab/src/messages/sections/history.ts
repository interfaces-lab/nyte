import { type Section, call, ok, part, said, shell, turn, user } from "../build";

export const historySection: Section = {
  id: "history",
  title: "History",
  detail:
    "Notes between turns, and a requestless turn: a background report opens a turn that rides under the previous prompt.",
  specimens: [
    {
      id: "compaction",
      title: "Context summarized",
      source: 'partKind = "compaction" · role = "note"',
      scene: {
        turns: [
          turn([
            part(
              "compaction",
              "note",
              {
                summary:
                  "The user is moving tool call density from a global read to a prop. `TurnView` and `LiveTurn` take it; `Timeline` passes it. The lab call sites were updated.",
                material: null,
                tokensBefore: 182_000,
                usage: null,
              },
              0,
            ),
          ]),
        ],
      },
    },
    {
      id: "branch-summary",
      title: "Branch summary",
      source: 'partKind = "branchSummary" · role = "note"',
      scene: {
        turns: [
          turn([
            part(
              "branchSummary",
              "note",
              {
                markdown:
                  "On the abandoned branch the assistant tried a density context provider, then dropped it for a prop.",
              },
              0,
            ),
          ]),
        ],
      },
    },
    {
      id: "continuation",
      title: "Background report continues a turn",
      source: "TurnInfo.prompt = null → TranscriptRow.continuations",
      scene: {
        turns: [
          turn([
            user("Run the e2e suite in the background and tell me when it's done."),
            call(
              shell("pnpm --dir packages/app e2e", "run e2e in the background"),
              ok(),
              2,
              "Started job e2e-41",
            ),
            said("Started. I'll report back when it finishes.", 3),
          ]),
          turn([]),
          turn([said("The e2e suite finished: 48 passed, 0 failed.", 240)]),
        ],
      },
    },
  ],
};
