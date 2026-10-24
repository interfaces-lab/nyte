import type { SessionView } from "@nyte-ai/sdk";
import type { Task } from "../../src/lib/tasks.ts";
import type { Msg } from "../../src/model/msg.ts";
import type { State } from "../../src/model/state.ts";
import { Screen } from "../../src/ui/screen.tsx";
import { buildView, followed } from "../../test/fixture/view.ts";
import type { ViewBuilder } from "../../test/fixture/view.ts";
import { ready, S1 } from "../../test/model/support.ts";
import { defineStory } from "./story.tsx";
import type { Control } from "./story.tsx";

const RUNS = ["idle", "working", "stopping", "retrying"] as const;

const QUEUES = [
  "empty",
  "queued",
  "attached",
  "sending",
  "retrying",
  "no host",
  "several",
] as const;

const FOLLOW_UPS = ["steer", "queue"] as const;

const CHATS = ["open", "opening"] as const;

const TASKS = [0, 1, 3] as const;

interface Dimensions {
  readonly run: (typeof RUNS)[number];
  readonly queue: (typeof QUEUES)[number];
  readonly followUp: (typeof FOLLOW_UPS)[number];
  readonly chat: (typeof CHATS)[number];
  readonly tasks: (typeof TASKS)[number];
}

const INITIAL: Dimensions = {
  run: "idle",
  queue: "empty",
  followUp: "steer",
  chat: "open",
  tasks: 0,
};

function after<T>(values: readonly T[], current: T): T {
  return values[(values.indexOf(current) + 1) % values.length] ?? current;
}

const CONTROLS: readonly Control<Dimensions>[] = [
  {
    command: "composer.story.run",
    label: "run",
    cycle: (d) => ({ ...d, run: after(RUNS, d.run) }),
    shown: (d) => d.run,
  },
  {
    command: "composer.story.queue",
    label: "queue",
    cycle: (d) => ({ ...d, queue: after(QUEUES, d.queue) }),
    shown: (d) => d.queue,
  },
  {
    command: "composer.story.follow-up",
    label: "follow-up",
    cycle: (d) => ({ ...d, followUp: after(FOLLOW_UPS, d.followUp) }),
    shown: (d) => d.followUp,
  },
  {
    command: "composer.story.chat",
    label: "chat",
    cycle: (d) => ({ ...d, chat: after(CHATS, d.chat) }),
    shown: (d) => d.chat,
  },
  {
    command: "composer.story.tasks",
    label: "tasks",
    cycle: (d) => ({ ...d, tasks: after(TASKS, d.tasks) }),
    shown: (d) => String(d.tasks),
  },
];

function withFinished(v: ViewBuilder): ViewBuilder {
  return v.turn("t1", (t) =>
    t
      .user("Rename loadConfig to readConfig")
      .tool("bash", { output: "src/config.ts\nsrc/cli.ts" })
      .text("Renamed `loadConfig` to `readConfig` in 2 files.")
      .ended("completed"),
  );
}

function withRun(v: ViewBuilder, run: Dimensions["run"], now: number): ViewBuilder {
  if (run === "idle") return v;

  const working = v.turn(
    "t2",
    (t) => t.user("Now update the tests").tool("bash", { running: true }),
    { run: "r2" },
  );

  if (run === "retrying") return working.retrying("rate limited", now + 30_000, "r2");

  return working.live("r2", { stopping: run === "stopping" });
}

function withQueue(v: ViewBuilder, queue: Dimensions["queue"], now: number): ViewBuilder {
  const later = { schedule: { kind: "next-turn", reason: "requested" } } as const;

  switch (queue) {
    case "empty":
      return v;
    case "queued":
      return v.pending("Also update the changelog", later, { delivery: "queue" });
    case "attached":
      return v.pending("Keep the old name as an alias", { schedule: { kind: "attached" } });
    case "sending":
      return v.unsent("Run the tests after", { delivery: "queue" });
    case "retrying":
      return v.unsent("Run the tests after", { retrying: { at: now + 5_000, reason: "offline" } });
    case "no host":
      return v.pending("Also update the changelog", { ...later, covered: false });
    case "several":
      return v
        .pending("Keep the old name as an alias", { schedule: { kind: "attached" } })
        .pending("Also update the changelog", later, { delivery: "queue" })
        .pending("Then bump the minor version", later, { delivery: "queue" })
        .pending("And open a pull request with a summary of every renamed call site", later, {
          delivery: "queue",
        })
        .unsent("Run the tests after", { delivery: "queue" });
    default: {
      const _exhaustive: never = queue;

      return _exhaustive;
    }
  }
}

function composerView(d: Dimensions, now: number): SessionView {
  return buildView((v) => withQueue(withRun(withFinished(v), d.run, now), d.queue, now));
}

function backgroundTasks(count: number): readonly Task[] {
  return Array.from({ length: count }, (_, index) => {
    const view = buildView((v) => v.turn("c", (t) => t.user("Search the docs")).live());
    const info = { ...followed(view, `c${String(index + 1)}`).info, parent: S1 };

    return { kind: "agent", id: info.id, info, view };
  });
}

function composerFacts(d: Dimensions, state: State, now: number): readonly Msg[] {
  const view = composerView(d, now);
  const session = followed(view);

  return [
    { kind: "settings", settings: { ...state.facts.settings, followUp: d.followUp } },
    d.chat === "opening"
      ? {
          kind: "session-opened",
          session: session.id,
          info: session.info,
          selection: session.selection,
        }
      : { kind: "view", session: session.id, view },
    { kind: "tasks", session: session.id, tasks: backgroundTasks(d.tasks) },
  ];
}

/**
 * The bottom of the chat screen: queue rows, background tasks line, composer, powerline and
 * hints. It reads the most state of any component: run, queue, follow-up, blocked and tasks
 * each change its rows, placeholder and hints.
 */
export const composerStory = defineStory<Dimensions>({
  id: "composer",
  title: "Composer with queue, run, follow-up, blocked and background-task states",
  initial: INITIAL,
  controls: CONTROLS,
  fixture: () => ready(composerView(INITIAL, 0)),
  facts: composerFacts,
  view: () => <Screen />,
});
