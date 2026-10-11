import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Message, RunView, SessionView, TurnInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { HostState } from "../nyte.ts";
import type { DesktopCatalog } from "../catalog.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { ThreadScreen } from "./thread.tsx";
import { createAppRouter } from "../router.tsx";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { USAGE, endedTurn, sessionRow } from "../../test/view-fixtures.ts";

const ID = asId<"session">("thread-render");

const liveRun: RunView = {
  id: asId<"run">("current-run"),
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
  origin: { kind: "input", message: asId<"message">("pending") },
};

const turnId = asId<"turn">("live");

const prompt: Message = {
  id: asId<"message">("stable-user"),
  turn: turnId,
  at: 0,
  kind: "user",
  content: Array.from({ length: 12 }, (_, index) => `Prompt line ${String(index)}`).join("\n"),
  source: { kind: "user" },
  delivery: "steer",
  status: { kind: "landed", commit: asId<"commit">("stable-user"), run: null, replaced: null },
  siblings: { index: 0, count: 1, ids: [] },
};

function part(
  id: string,
  partKind: string,
  state: unknown,
  status: Extract<Message, { readonly kind: "part" }>["status"] = {
    kind: "settled",
    commit: asId<"commit">(id),
    endedAt: 1,
  },
): Message {
  return {
    id: asId<"message">(id),
    turn: turnId,
    at: 1,
    kind: "part",
    part: asId<"part">(id),
    partKind,
    role: partKind === "text" ? "answer" : "step",
    state,
    version: 1,
    status,
  };
}

const thought = part("stable-plan", "thinking", {
  markdown: "Stable plan",
  merged: 1,
  signature: null,
});

const answer = part("stable-answer", "text", { markdown: "Stable answer", signature: null });

const action = (
  status: Extract<Message, { readonly kind: "user" }>["status"],
  turn = asId<"turn">("pending:pending"),
): Message => ({
  id: asId<"message">("pending"),
  turn,
  at: 2,
  kind: "user",
  content: "Instructions for the selected Git action.",
  source: { kind: "action", label: "Pending prompt" },
  delivery: "steer",
  status,
  siblings: { index: 0, count: 1, ids: [] },
});

const working: TurnInfo["state"] = { kind: "working", activity: null };

function view(messages: readonly Message[], change: Partial<SessionView> = {}): SessionView {
  const turn = endedTurn([], { id: turnId, prompt: prompt.id, state: working, steps: 1 }).info;

  return {
    revision: asId<"revision">("r1"),
    activation: { kind: "active" },
    messages,
    parts: [],
    turns: [turn],
    execution: { kind: "live", run: liveRun, phase: "responding", stopping: false },
    background: [],
    configuration: { selected: liveRun.configuration, effective: liveRun.configuration },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
    ...change,
  };
}

const pending = action({
  kind: "pending",
  schedule: { kind: "joined", run: liveRun.id },
  covered: true,
});

const stream = viewStream(view([prompt, thought, answer, pending]));

installConnection(
  scriptedConnection({
    sessions: [sessionRow("thread-render", { name: "Identity test" })],
    views: new Map([[ID, stream]]),
  }).connection,
);

const catalog = {
  providers: [],
  models: [],
  defaults: { model: { provider: "test", id: "test" }, thinkingLevel: "off" },
} satisfies DesktopCatalog;

const host = { workspace: undefined, platform: "linux" } satisfies HostState;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let renderFailure: unknown;

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (renderFailure !== undefined) throw renderFailure;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function textNode(container: HTMLElement, text: string): Element | undefined {
  return Array.from(container.querySelectorAll("p, div, span")).find(
    (node) => node.textContent === text,
  );
}

function clickMessage(row: Element): void {
  const text = row.querySelector("[data-composer-readonly]");

  if (!(text instanceof HTMLElement)) throw new Error("The message has no text to click");
  text.click();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

export async function runTest(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.catalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles, []);

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/${ID}`] }),
  });

  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:700px";
  document.body.append(container);
  renderFailure = undefined;

  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderFailure = error;
    },
  });

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider workspaceKey="thread-render-test">
              <SessionDndProvider>
                <ThreadScreen routeSessionId={ID} />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    await until(() => textNode(container, "Pending prompt") !== undefined, "the landing row");

    const landing =
      textNode(container, "Pending prompt")?.closest<HTMLDivElement>("[data-index]") ?? undefined;

    if (landing === undefined) throw new Error("The landing message has no transcript row");

    const landed = action(
      { kind: "landed", commit: asId<"commit">("landed-user"), run: liveRun.id, replaced: null },
      asId<"turn">("landed"),
    );
    stream.push(
      view([prompt, thought, answer, landed], {
        turns: [
          endedTurn([], { id: turnId, prompt: prompt.id, state: working }).info,
          endedTurn([], { id: asId<"turn">("landed"), prompt: landed.id, state: working }).info,
        ],
      }),
    );
    await until(
      () => landing.firstElementChild?.getAttribute("title") === null,
      "the landing message to settle",
    );
    check(
      textNode(container, "Pending prompt")?.closest("[data-index]") === landing,
      "The landed message replaced its transcript row",
    );
    check(
      !Array.from(landing.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Edit Message",
      ),
      "Action messages must remain read-only after landing",
    );

    const editMessage = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Edit Message",
    );

    if (editMessage === undefined) throw new Error("Ordinary user messages must remain editable");
    const editableRow = editMessage.closest("[data-sticky-user-message]");

    if (editableRow === null) throw new Error("Missing editable message row");
    clickMessage(editableRow);
    await until(
      () => editableRow.querySelector('[contenteditable="true"]') !== null,
      "the message editor to open",
    );
    const editor = editableRow.querySelector('[contenteditable="true"]');
    editor?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(
      () => editableRow.querySelector('[contenteditable="true"]') === null,
      "the message edit to cancel",
    );
    check(
      !container.textContent?.includes("Instructions for the selected Git action."),
      "Action instructions must display their compact label",
    );

    const idle: SessionView["execution"] = {
      kind: "idle",
      lastRun: { id: liveRun.id, end: { kind: "completed", usage: USAGE }, endedAt: 3 },
    };
    const ended: TurnInfo["state"] = { kind: "ended", end: { kind: "completed", usage: USAGE } };
    const settledView = view([prompt, thought, answer], {
      execution: idle,
      turns: [endedTurn([], { id: turnId, prompt: prompt.id, state: ended, steps: 1 }).info],
    });
    stream.push(settledView);
    await until(
      () =>
        Array.from(container.querySelectorAll("button")).some((button) =>
          button.textContent?.includes("Thought"),
        ),
      "the run to settle",
    );
    const stable = textNode(container, "Stable answer")?.closest<HTMLDivElement>("[data-index]");
    check(stable !== undefined, "The settled answer has a transcript row");
    clickMessage(editableRow);
    await until(
      () => editableRow.querySelector('[contenteditable="true"]') !== null,
      "the settled message editor to open",
    );

    for (let index = 0; index < 20; index += 1) {
      const streaming = part(
        "live-text",
        "text",
        {
          markdown: Array.from({ length: index + 1 }, (_, digit) => String(digit)).join(""),
          signature: null,
        },
        { kind: "live", run: liveRun.id },
      );
      stream.push({ ...settledView, messages: [prompt, thought, answer, streaming] });
      await nextFrame();
      await nextFrame();
    }

    check(
      textNode(container, "Stable answer")?.closest("[data-index]") === stable,
      "Live deltas replaced a settled transcript row",
    );
    check(
      editableRow.querySelector('[contenteditable="true"]') !== null,
      "Live deltas closed the message edit",
    );

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

export const run = runTest;

applyDisplayMode("light");
