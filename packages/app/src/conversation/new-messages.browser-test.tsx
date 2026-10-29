import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Message, ModelCatalogView, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { HostState } from "../contract/nyte.ts";
import { PaneControllerProvider } from "../panes/pane-context.tsx";
import { SessionDndProvider } from "../panes/session-dnd.tsx";
import { keys, queryClient } from "../data/query-client.ts";
import { installConnection } from "../data/connection.ts";
import { SessionScreen } from "../panes/session-screen.tsx";
import { createAppRouter } from "../shell/routes.tsx";
import { windowTabs } from "../tabs/window-tabs.ts";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { COMPLETED, USAGE, endedTurn, sessionRow } from "../../test/view-fixtures.ts";

const ID = asId<"session">("new-messages");

const TURNS = 40;

/** Read through turn 37's answer, so 38, 39 and 40 are unread. */
const SEEN_THROUGH = 375;

const turnId = (index: number) => asId<"turn">(`turn-${String(index)}`);

function answer(index: number, markdown: string): Message {
  return {
    id: asId<"message">(`answer-${String(index)}`),
    turn: turnId(index),
    at: index * 10 + 5,
    kind: "part",
    part: asId<"part">(`answer-${String(index)}`),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status: { kind: "settled", commit: asId<"commit">(`answer-${String(index)}`), endedAt: 1 },
  };
}

const LONG = "An unread reply long enough to fill much of the view. ".repeat(24);

function turn(index: number, reply = `Answer ${String(index)}.${index > 37 ? `\n\n${LONG}` : ""}`) {
  const prompt: Message = {
    id: asId<"message">(`prompt-${String(index)}`),
    turn: turnId(index),
    at: index * 10,
    kind: "user",
    content: `Question ${String(index)}`,
    source: { kind: "user" },
    delivery: "queue",
    status: {
      kind: "landed",
      commit: asId<"commit">(`prompt-${String(index)}`),
      run: null,
      replaced: null,
    },
    siblings: { index: 0, count: 1, ids: [] },
  };

  const { info } = endedTurn([], {
    id: turnId(index),
    prompt: prompt.id,
    steps: 2,
  });

  return { info, messages: [prompt, answer(index, reply)] };
}

function view(count: number, last?: string): SessionView {
  const turns = Array.from({ length: count }, (_, index) =>
    index + 1 === count && last !== undefined ? turn(count, last) : turn(index + 1),
  );

  return {
    revision: asId<"revision">(`r${String(count)}`),
    seq: asSeq(count),
    activation: { kind: "active" },
    messages: turns.flatMap((entry) => entry.messages),
    queue: [],
    leadingPrompt: null,
    parts: [],
    turns: turns.map((entry) => entry.info),
    usage: USAGE,
    execution: COMPLETED,
    reportsHeld: false,
    seenThrough: SEEN_THROUGH,
    background: [],
    configuration: { selected: null, effective: null },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

const stream = viewStream(view(TURNS));

installConnection(
  scriptedConnection({
    sessions: [sessionRow("new-messages", { name: "New messages" })],
    views: new Map([[ID, stream]]),
  }).connection,
);

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: undefined } satisfies HostState;

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) await painted();
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await painted();
  }
}

function element(container: HTMLElement, selector: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(selector);

  if (found === null) throw new Error(`Missing ${selector}`);

  return found;
}

export async function run(): Promise<string> {
  applyDisplayMode("light");
  queryClient.clear();
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles, []);
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:700px";
  document.body.append(container);

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/${ID}`] }),
  });

  const root = createRoot(container);
  const panes = windowTabs.controller();
  panes.selectSession(ID);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider controller={panes}>
              <SessionDndProvider>
                <SessionScreen />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  const failures: string[] = [];

  const check = (passed: boolean, failure: string): void => {
    if (!passed) failures.push(failure);
  };

  try {
    await until(() => container.textContent?.includes("Answer 40.") === true, "the last answer");
    await frames(10);
    const viewport = element(container, "[aria-label='Messages']");

    const distance = (): number =>
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;

    const pill = (direction: "up" | "down"): HTMLElement | null =>
      container.querySelector<HTMLElement>(`[data-new-messages='${direction}']`);

    const scrollBy = async (delta: number): Promise<void> => {
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
      viewport.scrollTop += delta;
      viewport.dispatchEvent(new Event("scroll"));
      await frames(3);
    };

    check(distance() <= 4, "the chat opens at the end");
    check(
      pill("up")?.textContent === "3 New Messages" && pill("down") === null,
      `the up pill counts the three unread replies: ${String(pill("up")?.textContent)}`,
    );

    element(container, "[data-new-messages='up'] button").click();
    await frames(5);

    const revealed = container.querySelector<HTMLElement>(
      "[data-row-key='unread-divider:answer-38']",
    );

    const offset =
      (revealed?.getBoundingClientRect().top ?? 0) - viewport.getBoundingClientRect().top;

    check(
      Math.abs(offset - viewport.clientHeight / 3) <= 2,
      `the up pill puts the divider a third of the way down, not at ${String(offset)}px of ${String(viewport.clientHeight)}`,
    );
    check(pill("up") === null, "the up pill goes once clicked");
    check(revealed?.querySelector("[data-unread-divider]") !== null, "the divider stays");

    const dividers = container.querySelectorAll<HTMLElement>("[data-unread-divider]");
    const divider = dividers[0];
    const dividerRow = divider?.closest<HTMLElement>("[data-row-key]");

    const next = container.querySelector<HTMLElement>(
      `[data-index='${String(Number(dividerRow?.dataset.index) + 1)}']`,
    );

    check(dividers.length === 1, `one divider, found ${String(dividers.length)}`);
    check(
      dividerRow?.dataset.rowKey === "unread-divider:answer-38" &&
        next?.dataset.rowKey === "response:answer-38",
      "the divider sits right before the first unread reply",
    );
    check(divider?.textContent === "New messages below", "the divider reads New messages below");

    viewport.focus();
    check(document.activeElement === viewport, "the reader is in the transcript");
    element(container, "[data-slot='scroll-to-bottom'] button").click();
    await frames(5);
    check(distance() <= 4, "scroll to bottom reaches the end");
    check(
      document.activeElement?.closest("[data-composer-frame]") !== null,
      "scroll to bottom focuses the composer",
    );

    await scrollBy(-400);
    stream.push(view(41, "Answer 41 starts."));
    await frames(5);
    check(
      pill("down")?.textContent === "1 New Message" && pill("up") === null,
      `a reply below an away reader shows the down pill: ${String(pill("down")?.textContent)}`,
    );
    stream.push(view(41, "Answer 41 starts and keeps streaming more text."));
    await frames(5);
    check(pill("down")?.textContent === "1 New Message", "a streaming reply counts once");

    const reading = viewport.scrollTop;
    element(
      container,
      "[data-new-messages='down'] button[aria-label='Dismiss new messages']",
    ).click();
    await frames(5);
    check(Math.abs(viewport.scrollTop - reading) <= 1, "dismissing the down pill doesn't scroll");
    check(pill("down") === null, "dismissing the down pill hides it");
    stream.push(view(42));
    await frames(5);
    check(pill("down")?.textContent === "1 New Message", "the next reply counts from one");

    element(container, "[data-new-messages='down'] button").click();
    await frames(5);
    check(distance() <= 4 && pill("down") === null, "the down pill returns to the end");
    const end = viewport.scrollTop;

    for (
      let step = 0;
      step < 20 && container.querySelector("[data-unread-divider]") === null;
      step += 1
    )
      await scrollBy(-200);
    check(
      container.querySelector("[data-unread-divider]") !== null,
      "returning to the end keeps the divider",
    );
    element(container, "[data-slot='scroll-to-bottom'] button").click();
    await frames(5);
    check(Math.abs(viewport.scrollTop - end) <= 4, "scroll to bottom returns to the end");

    await scrollBy(120);
    stream.push(view(42, `Answer 42.\n\n${"A longer answer grows the end. ".repeat(40)}`));
    await frames(5);
    check(distance() <= 4, "a downward wheel at the end keeps following");

    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight - 3;
    viewport.dispatchEvent(new Event("scroll"));
    await frames(2);
    stream.push(view(42, `Answer 42.\n\n${"A longer answer grows the end. ".repeat(80)}`));
    await frames(5);
    check(distance() <= 4, "a view 3 px short of the end keeps following");

    await scrollBy(-2);
    const held = viewport.scrollTop;
    stream.push(view(42, `Answer 42.\n\n${"A longer answer grows the end. ".repeat(120)}`));
    await frames(5);
    check(
      Math.abs(viewport.scrollTop - held) <= 1 && distance() > 4,
      "a reader's 2 px upward wheel stops following",
    );

    return failures.length === 0 ? "passed" : failures.join("\n");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}
