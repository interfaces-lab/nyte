import "../../test/window-bridge.ts";
import { Activity } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Message, PartStatus, RunView, SessionId, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { USAGE } from "../../test/view-fixtures.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { installConnection, sessionWatch } from "../sdk.tsx";
import { LiveTurn } from "./live-turn.tsx";
import { TranscriptProvider } from "./transcript.tsx";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle() {
  for (let index = 0; index < 4; index += 1) await frame();
}

const STALL_MS = 5_000;

async function until(done: () => boolean, deadline: number) {
  while (!done() && performance.now() < deadline) await wait(50);
}

const RUN: RunView = {
  id: asId<"run">("live-turn-run"),
  head: asId<"head">("main"),
  startedAt: 0,
  attempt: 1,
  configuration: {
    kind: "exact",
    model: { provider: "test", id: "test" },
    thinking: "off",
    agent: null,
    settings: {},
    settingsVersion: "1",
  },
  origin: { kind: "input", message: asId<"message">("prompt") },
};

const QUIET = asId<"session">("live-turn-quiet");

const BUSY = asId<"session">("live-turn-busy");

function view(messages: readonly Message[]): SessionView {
  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    queue: [],
    leadingPrompt: null,
    parts: [],
    turns: [],
    usage: USAGE,
    execution: { kind: "live", run: RUN, phase: "responding", stopping: false },
    reportsHeld: false,
    background: [],
    configuration: { selected: RUN.configuration, effective: RUN.configuration },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
    messages,
  };
}

function part(id: string, live: boolean) {
  const status: PartStatus = live
    ? { kind: "live", run: RUN.id }
    : { kind: "settled", commit: asId<"commit">(id), endedAt: 2 };

  return {
    id: asId<"message">(id),
    turn: asId<"turn">("turn"),
    at: 1,
    kind: "part",
    part: asId<"part">(id),
    version: 1,
    status,
  } as const;
}

function text(id: string, markdown: string, live: boolean): Message {
  return {
    ...part(id, live),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
  };
}

function thinking(id: string, live: boolean): Message {
  return {
    ...part(id, live),
    partKind: "thinking",
    role: "step",
    state: { markdown: "Weighing the lease", merged: 1, signature: null },
  };
}

function delegate(id: string, live: boolean): Message {
  const call = {
    call: asId<"call">(id),
    name: "task",
    args: null,
    class: { kind: "delegate", child: null, role: "task", title: "Audit" },
  } as const;

  return {
    ...part(id, live),
    partKind: "tool",
    role: "step",
    state: live
      ? { ...call, phase: "running", progress: null }
      : {
          ...call,
          phase: "settled",
          outcome: { kind: "ok", content: [], output: null, parts: [] },
          changes: null,
        },
  };
}

const ANSWER = "Reading the lease helper before I touch the call sites.";

const quiet = viewStream(view([]));

const busy = viewStream(view([text("answer", "Reading", true)]));

installConnection(
  scriptedConnection({
    views: new Map([
      [QUIET, quiet],
      [BUSY, busy],
    ]),
  }).connection,
);

const panes = new PaneController({ storageKey: "live-turn-test" });

function mount(session: SessionId) {
  const box = document.createElement("div");
  box.style.cssText = "width:640px";
  document.body.append(box);
  const root = createRoot(box);

  const render = (mode: "visible" | "hidden") =>
    flushSync(() =>
      root.render(
        <PaneControllerProvider controller={panes}>
          <TranscriptProvider paneId="primary" sessionId={session}>
            <Activity mode={mode}>
              <LiveTurn working settledWork={false} />
            </Activity>
          </TranscriptProvider>
        </PaneControllerProvider>,
      ),
    );

  render("visible");

  return { box, render };
}

function shown(box: HTMLElement): string {
  const label = box.querySelector("[aria-busy] span");

  return label instanceof HTMLElement && getComputedStyle(label).visibility === "visible"
    ? (label.textContent ?? "")
    : "";
}

function rowHeight(box: HTMLElement): number {
  return box.firstElementChild?.getBoundingClientRect().height ?? 0;
}

interface Change {
  readonly at: number;
  readonly label: string;
}

function recordLabels(box: HTMLElement) {
  const changes: Change[] = [{ at: performance.now(), label: shown(box) }];

  const observer = new MutationObserver(() => {
    const next = shown(box);

    if (next !== changes.at(-1)?.label) changes.push({ at: performance.now(), label: next });
  });

  observer.observe(box, { subtree: true, childList: true, characterData: true, attributes: true });

  return { changes, stop: () => observer.disconnect() };
}

function timeline(changes: readonly Change[], from: number): string {
  return changes
    .map((change) => `"${change.label}" @${String(Math.round(change.at - from))}ms`)
    .join(" → ");
}

function firstShown(changes: readonly Change[], after: number): Change | undefined {
  return changes.find((change) => change.at >= after && change.label !== "");
}

async function waitForShown(changes: readonly Change[], after: number) {
  await until(() => firstShown(changes, after) !== undefined, after + 200 + STALL_MS);

  return firstShown(changes, after);
}

async function streamingHidesIt(box: HTMLElement) {
  await settle();
  const height = rowHeight(box);
  check(height > 0, "The live row keeps its line while text streams");
  const labels = recordLabels(box);
  const streamed = performance.now();

  for (let words = 2; words <= 9; words += 1) {
    busy.push(view([text("answer", ANSWER.split(" ").slice(0, words).join(" "), true)]));
    await wait(60);
  }

  check(
    labels.changes.every((change) => change.label === ""),
    `Streaming text hides the bottom row: ${timeline(labels.changes, streamed)}`,
  );
  check(rowHeight(box) === height, "Hiding the label keeps the row's space");

  const answered = performance.now();
  busy.push(view([text("answer", ANSWER, false)]));
  const planned = await waitForShown(labels.changes, answered);

  check(
    planned?.label === "Planning next moves" &&
      planned.at - answered >= 200 &&
      planned.at - answered <= 200 + STALL_MS,
    `Once the text settles the row waits 200 ms, then plans: ${timeline(labels.changes, answered)}`,
  );
  check(rowHeight(box) === height, "Showing the label doesn't move the transcript");

  busy.push(view([text("answer", ANSWER, false), text("more", "Then", true)]));
  await settle();
  check(shown(box) === "", "New text hides the planning label at once");

  const resumed = performance.now();
  busy.push(view([text("answer", ANSWER, false), text("more", "Then the tests.", false)]));
  const replanned = await waitForShown(labels.changes, resumed);

  check(
    replanned?.label === "Planning next moves" && replanned.at - resumed >= 200,
    `New text restarts the 200 ms wait: ${timeline(labels.changes, resumed)}`,
  );

  busy.push(view([text("answer", ANSWER, false), thinking("weigh", true)]));
  await settle();
  check(shown(box) === "", "Live thinking hides the bottom row");

  const delegated = performance.now();
  busy.push(
    view([text("answer", ANSWER, false), thinking("weigh", false), delegate("audit", true)]),
  );
  await wait(400);
  check(
    firstShown(labels.changes, delegated) === undefined,
    `A running subagent hides the bottom row: ${timeline(labels.changes, delegated)}`,
  );

  const finished = performance.now();
  busy.push(
    view([text("answer", ANSWER, false), thinking("weigh", false), delegate("audit", false)]),
  );
  const after = await waitForShown(labels.changes, finished);
  labels.stop();

  check(
    after?.label === "Planning next moves" && after.at - finished >= 200,
    `A finished subagent hands back to planning after 200 ms: ${timeline(labels.changes, finished)}`,
  );
  check(rowHeight(box) === height, "Every state keeps the row's space");
}

export async function run(): Promise<string> {
  const sessions = [QUIET, BUSY];

  for (const session of sessions) sessionWatch(session).subscribe(() => undefined);

  for (
    let index = 0;
    sessions.some((session) => sessionWatch(session).getState().value === undefined);
    index += 1
  ) {
    check(index < 120, "Both sessions' views arrive before their live rows mount");
    await frame();
  }

  const mounted = performance.now();
  const quietRow = mount(QUIET);
  const quietLabels = recordLabels(quietRow.box);
  await streamingHidesIt(mount(BUSY).box);
  await until(
    () => quietLabels.changes.some((change) => change.label === "Taking longer than expected…"),
    mounted + 15_000 + STALL_MS,
  );
  const seen = timeline(quietLabels.changes, mounted);
  const planning = quietLabels.changes[1];
  const slow = quietLabels.changes[2];

  check(
    quietLabels.changes[0]?.label === "" &&
      planning?.label === "Planning next moves" &&
      planning.at - mounted >= 200 &&
      planning.at - mounted <= 200 + STALL_MS,
    `A quiet turn shows nothing for 200 ms, then plans: ${seen}`,
  );
  check(
    quietLabels.changes.length === 3 &&
      slow?.label === "Taking longer than expected…" &&
      slow.at - mounted >= 15_000 &&
      slow.at - mounted <= 15_000 + STALL_MS,
    `After 15 s of planning the row says it is taking longer: ${seen}`,
  );

  quietRow.render("hidden");
  await settle();
  quietRow.render("visible");
  await wait(1_000);
  quietLabels.stop();

  check(
    quietLabels.changes.length === 3 && shown(quietRow.box) === "Taking longer than expected…",
    `Switching to another chat and back keeps the slow label: ${timeline(quietLabels.changes, mounted)}`,
  );

  return "passed";
}

applyDisplayMode("light");
