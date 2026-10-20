import { asId } from "@nyte-ai/schema";
import {
  LIVE,
  NEEDS_INPUT,
  PROMPT,
  RUN,
  RUNNING,
  RUN_VIEW,
  type Section,
  T0,
  WORKING,
  call,
  custom,
  executing,
  lines,
  ok,
  pending,
  read,
  responding,
  said,
  shell,
  thought,
  turn,
  user,
} from "../build";

export const liveSection: Section = {
  id: "live",
  title: "Run in flight",
  detail:
    "The trailing turn while a run is live. Streaming parts are messages with status live; the view carries them like any other.",
  specimens: [
    {
      id: "live-waiting",
      title: "Working, nothing streamed yet",
      source: 'execution = live · phase = "responding"',
      scene: { turns: [turn([user(PROMPT)], WORKING)], execution: responding() },
    },
    {
      id: "live-thinking",
      title: "Streaming reasoning",
      source: 'thinking · status = "live"',
      scene: {
        turns: [
          turn(
            [
              user(PROMPT),
              thought(
                "**Reading the summary**\n\nThe verb comes from `settledSummary`. A failed call is tallied before",
                1,
                LIVE,
              ),
            ],
            WORKING,
          ),
        ],
        execution: responding(),
      },
    },
    {
      id: "live-text",
      title: "Streaming prose",
      source: 'text · status = "live"',
      scene: {
        turns: [
          turn(
            [
              user(PROMPT),
              call(read("packages/app/src/conversation/step-group-presentation.ts"), ok(), 1),
              said(
                "The settled summary already leads with the outcome. What reads badly is the **trouble** case, where",
                2,
                LIVE,
              ),
            ],
            WORKING,
          ),
        ],
        execution: responding(),
      },
    },
    {
      id: "live-tool",
      title: "Running a tool with progress",
      source: 'phase = "executing" · tool phase = "running" · progress',
      scene: {
        turns: [
          turn(
            [
              user(PROMPT),
              thought("**Running the tests**\n\nThe step group tests cover every density.", 1),
              call(read("packages/app/src/conversation/step-group.tsx"), ok(), 2),
              call(
                shell("pnpm --dir packages/app test"),
                {
                  phase: "running",
                  progress: lines(
                    " RUN  v4.1.0 /Users/lab/nyte/packages/app",
                    "",
                    " ✓ src/conversation/step-group-presentation.test.ts (9 tests) 4ms",
                    " ❯ src/conversation/step-group.test.ts 3/14",
                  ),
                },
                3,
              ),
            ],
            { kind: "working", activity: "Running" },
          ),
        ],
        execution: executing(),
      },
    },
    {
      id: "live-input",
      title: "Parked on a question",
      source: 'execution = waiting · on = { kind: "part" }',
      scene: {
        turns: [
          turn(
            [user("Delete the generated fixtures?"), call(custom("Ask user"), NEEDS_INPUT, 2)],
            WORKING,
          ),
        ],
        execution: {
          kind: "waiting",
          run: RUN_VIEW,
          on: { kind: "part", part: asId<"part">("lab-question") },
        },
      },
    },
    {
      id: "live-retry",
      title: "Retrying",
      source: "execution = retrying",
      scene: {
        turns: [turn([user(PROMPT)], WORKING)],
        execution: {
          kind: "retrying",
          run: RUN_VIEW,
          until: T0 + 30_000,
          reason: "The model is temporarily unavailable.",
        },
      },
    },
    {
      id: "live-stopping",
      title: "Stopping",
      source: "execution.stopping = true",
      scene: {
        turns: [turn([user(PROMPT), call(shell("pnpm build"), RUNNING, 2)], WORKING)],
        execution: executing(true),
      },
    },
    {
      id: "prompt-pending",
      title: "Sent while a run is live",
      source: 'prompt · status = pending · schedule = "joined"',
      scene: {
        turns: [
          turn([user(PROMPT), call(shell("pnpm --dir packages/app test"), RUNNING, 2)], WORKING),
        ],
        execution: executing(),
        prompts: [pending("Also run the lab typecheck.", { kind: "joined", run: RUN })],
      },
    },
    {
      id: "prompt-idle",
      title: "Sent, not landed yet",
      source: "prompt · status = pending · no turn yet",
      scene: {
        turns: [],
        prompts: [pending(PROMPT, { kind: "next-turn", reason: "idle" })],
      },
    },
  ],
};
