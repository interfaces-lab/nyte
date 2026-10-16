import {
  PROMPT,
  type Section,
  call,
  created,
  edited,
  ok,
  said,
  touched,
  turn,
  user,
} from "../build";

export const outcomesSection: Section = {
  id: "outcomes",
  title: "Turn outcomes",
  detail:
    "A turn that ended failed carries why the assistant stopped; failureNotice words each class. Turns with settled edits end in a changes card.",
  specimens: [
    {
      id: "failure-classes",
      title: "Every failure class",
      source: "TurnInfo.state.end.failure.class × 9",
      scene: {
        turns: (
          [
            ["aborted", "Aborted by the user."],
            ["rate_limit", "429"],
            ["context_window", "prompt is too long"],
            ["quota", "insufficient_quota"],
            ["auth", "401"],
            ["overloaded", "529"],
            ["network", "ECONNRESET"],
            ["provider", "The provider closed the stream before the response completed."],
            ["runner", "The tool batch exceeded its step ceiling."],
          ] as const
        ).map(([failureClass, message], index) =>
          turn([said(`Response ${String(index + 1)} started…`, index)], {
            kind: "ended",
            end: { kind: "failed", failure: { class: failureClass, message } },
          }),
        ),
      },
    },
    {
      id: "changes-card",
      title: "Changes card",
      source: "settled edit changes → TurnChangesCard",
      scene: {
        turns: [
          turn([
            user(PROMPT),
            call(edited, ok(), 4),
            call(created, ok(), 9),
            said("Two files changed.", 11),
          ]),
        ],
      },
    },
    {
      id: "changes-many",
      title: "Changes card, more than five files",
      source: "changes > CHANGES_VISIBLE_FILES",
      scene: {
        turns: [
          turn([
            user("Thread density through every TurnView caller."),
            ...[
              "packages/app/src/conversation/turn-view.tsx",
              "packages/app/src/conversation/live-turn.tsx",
              "packages/app/src/conversation/timeline.tsx",
              "packages/lab/src/canvas/turn.tsx",
              "packages/lab/src/review/guide.tsx",
              "packages/lab/src/review/side-chat.tsx",
              "packages/app/src/conversation/subagent-call.test.tsx",
            ].map((file, index) => call(touched(file), ok(), index + 1)),
            said("Every caller passes `density`.", 9),
          ]),
        ],
      },
    },
  ],
};
