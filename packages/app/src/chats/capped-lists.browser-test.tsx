import "../../test/window-bridge.ts";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { asId } from "@nyte-ai/schema";
import type { BackgroundItem, Execution, HeadInfo, SessionId, SessionView } from "@nyte-ai/sdk";
import { QueryClientProvider } from "@tanstack/react-query";
import { installScripted, scriptedConnection } from "../../test/scripted-connection.ts";
import { sessionRow, sessionView } from "../../test/view-fixtures.ts";
import { useQuestionDock } from "../chat/trays/questions-state.ts";
import { queryClient } from "../data/query-client.ts";
import { liveRun } from "../panes/session-screen-render.fixtures.ts";
import { useChatTasks, useChildTasks } from "./index.ts";
import type { ChildTask } from "./index.ts";

const ROOT = asId<"session">("root");

const MIDDLE = asId<"session">("middle");

const LEAF = asId<"session">("leaf");

const QUESTION = asId<"part">("question");

const ASKED = "Which branch should the fix go on?";

const OWN_RUN_WAITS: Execution = {
  kind: "waiting",
  run: liveRun,
  on: { kind: "run", session: LEAF, run: liveRun.id },
};

const ASKING: Execution = { kind: "waiting", run: liveRun, on: { kind: "part", part: QUESTION } };

function waitingChild(id: SessionId, title: string): BackgroundItem {
  return { kind: "child", id, title, state: "waiting", startedBy: null };
}

function heads(execution: Execution, waiting = 0): readonly HeadInfo[] {
  return [
    {
      name: asId<"head">("main"),
      tip: { kind: "start" },
      stack: null,
      execution,
      unread: false,
      background: { working: 0, waiting },
    },
  ];
}

/** The host's list of every session holds its 50 most active; the root's subagents are older. */
const others = Array.from({ length: 51 }, (_, index) => sessionRow(`other-${String(index)}`));

const middle = sessionRow("middle", {
  name: "Middle",
  parent: ROOT,
  heads: heads(OWN_RUN_WAITS, 1),
});

const leaf = sessionRow("leaf", { name: "Leaf", parent: MIDDLE, heads: heads(ASKING) });

const views = new Map<SessionId, readonly SessionView[]>([
  [ROOT, [sessionView({ background: [waitingChild(MIDDLE, "Middle")] })]],
  [
    MIDDLE,
    [
      sessionView({
        execution: OWN_RUN_WAITS,
        background: [waitingChild(LEAF, "Leaf")],
      }),
    ],
  ],
  [
    LEAF,
    [
      sessionView({
        execution: ASKING,
        parts: [
          {
            id: QUESTION,
            partKind: "ask/question",
            placement: { kind: "modal" },
            state: {
              call: "call-question",
              questions: [
                {
                  header: "Branch",
                  question: ASKED,
                  options: [{ label: "main", description: "" }],
                },
              ],
              phase: { kind: "asking" },
            },
            version: 1,
            status: { kind: "live", run: liveRun.id },
            owner: "question",
          },
        ],
      }),
    ],
  ],
]);

installScripted(
  scriptedConnection({
    sessions: [...others, sessionRow("root", { name: "Root" })],
    children: new Map([
      [ROOT, [middle]],
      [MIDDLE, [leaf]],
    ]),
    views,
  }),
);

function line(task: ChildTask): string {
  return `${task.title} ${task.state}${task.live ? " stoppable" : ""}`;
}

function RootChat(): ReactElement {
  const dock = useQuestionDock(ROOT);
  const tasks = useChatTasks(ROOT).flatMap((task) => (task.kind === "child" ? [task] : []));
  const nested = useChildTasks(MIDDLE);

  return (
    <output>
      {[
        `asks: ${dock === undefined ? "nothing" : `${dock.origin?.title}: ${dock.field.question}`}`,
        `tasks: ${tasks.map(line).join(", ")}`,
        `nested: ${nested.map(line).join(", ")}`,
      ].join("\n")}
    </output>
  );
}

const EXPECTED = [
  `asks: Leaf: ${ASKED}`,
  "tasks: Middle waiting stoppable",
  "nested: Leaf waiting stoppable",
].join("\n");

function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RootChat />
      </QueryClientProvider>,
    ),
  );

  for (let frame = 0; frame < 200 && container.textContent !== EXPECTED; frame += 1)
    await painted();
  const shown = container.textContent;
  flushSync(() => root.unmount());
  container.remove();

  return shown === EXPECTED ? "passed" : shown;
}
