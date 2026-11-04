import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { enableTracing } from "@nyte-ai/sdk";
import type { Message, ModelCatalogView, SessionInfo, SessionView } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import "../theme/tokens.stylex.ts";
import { installScripted, scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { endedTurn, sessionRow, sessionView } from "../../test/view-fixtures.ts";
import { tabPanes } from "../../test/panes.ts";
import type { HostState } from "../contract/nyte.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { createAppRouter } from "../shell/routes.tsx";
import type { LayoutAction, PaneTabId } from "./layout.ts";
import { LayoutView } from "./layout-view.tsx";
import { PaneControllerProvider } from "./pane-context.tsx";
import type { PaneContent } from "./pane-kinds.ts";
import { chatPanes } from "./pane-layout.ts";
import { renderPaneContent } from "./pane-views.tsx";
import { SessionDndProvider } from "./session-dnd.tsx";

const TURNS = 30;

const [LEFT, RIGHT] = ["layout-left", "layout-right"].map((id) => asId<"session">(id));

function view(session: string): SessionView {
  const messages: Message[] = [];
  const turns = [];

  for (let index = 1; index <= TURNS; index += 1) {
    const turn = asId<"turn">(`${session}-turn-${String(index)}`);
    const prompt = asId<"message">(`${session}-prompt-${String(index)}`);
    const answer = asId<"message">(`${session}-answer-${String(index)}`);
    messages.push(
      {
        id: prompt,
        turn,
        at: index,
        kind: "user",
        content: `Question ${String(index)} in ${session}`,
        source: { kind: "user" },
        delivery: "queue",
        status: { kind: "landed", commit: asId<"commit">(prompt), run: null, replaced: null },
        siblings: { index: 0, count: 1, ids: [] },
      },
      {
        id: answer,
        turn,
        at: index,
        kind: "part",
        part: asId<"part">(answer),
        partKind: "text",
        role: "answer",
        state: {
          markdown: `Answer ${String(index)}. ${"A sentence that fills the row. ".repeat(10)}`,
          signature: null,
        },
        version: 1,
        status: { kind: "settled", commit: asId<"commit">(answer), endedAt: index },
      },
    );
    turns.push(endedTurn([], { id: turn, prompt, steps: 2 }).info);
  }

  return sessionView({ messages, turns });
}

installScripted(
  scriptedConnection({
    sessions: viewStream<readonly SessionInfo[]>([sessionRow(LEFT), sessionRow(RIGHT)]),
    views: new Map([LEFT, RIGHT].map((id) => [id, viewStream(view(id))] as const)),
  }),
);

enableTracing();

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: undefined } satisfies HostState;

const COUNTED = ["render:conversation", "render:transcript-row", "render:composer"] as const;

interface Step {
  readonly name: string;
  /** Every tab body and transcript is the element it was before the step. */
  readonly sameElements: boolean;
  readonly scrollTop: number;
  /** The first transcript row in view: what a reader is looking at, which a reflow keeps. */
  readonly topRow: string | null;
  /** Tab bodies in DOM order, by session. */
  readonly order: readonly string[];
  readonly commits: Readonly<Record<(typeof COUNTED)[number], number>>;
}

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function tabBody(container: HTMLElement, tab: PaneTabId): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-nyte-pane-tab="${tab}"]`);
}

function transcript(body: HTMLElement | null): HTMLElement | null {
  return body?.querySelector<HTMLElement>("[aria-label='Messages']") ?? null;
}

/**
 * Scrolls as a reader does: the transcript reads a scroll as the reader's only within a short
 * window after their input, so the wheel repeats until the scroll lands, however busy the frame.
 */
async function readTo(scroller: HTMLElement, offset: number): Promise<void> {
  const wheel = (): boolean =>
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -offset, bubbles: true }));

  const landed = new Promise<void>((resolve) =>
    scroller.addEventListener("scroll", () => resolve(), { once: true }),
  );

  wheel();
  const steering = window.setInterval(wheel, 50);
  scroller.scrollTop = offset;
  await landed;
  await painted();
  window.clearInterval(steering);
  await painted();
}

function topRow(scroller: HTMLElement): string | null {
  const top = scroller.getBoundingClientRect().top;

  const rows = Array.from(scroller.querySelectorAll<HTMLElement>("[data-row-key]")).filter(
    (row) => row.getBoundingClientRect().bottom > top + 1,
  );

  const first = rows.toSorted(
    (left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top,
  )[0];

  return first?.getAttribute("data-row-key") ?? null;
}

async function checkLayout(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles(undefined), []);

  const panes = tabPanes();
  panes.selectSession(LEFT);
  panes.split("right");
  panes.selectSession(RIGHT);
  const store = panes.store;
  const [left, right] = chatPanes(store.getSnapshot());

  if (left === undefined || right === undefined) throw new Error("Expected two chat panes");

  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:1200px;height:700px";
  document.body.append(container);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
  const root = createRoot(container);

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider controller={panes}>
              <SessionDndProvider>
                <LayoutView store={store} renderTab={renderPaneContent} />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    await until(
      () =>
        [left.tab, right.tab].every(
          (tab) =>
            transcript(tabBody(container, tab))?.querySelector("[data-row-key]") !== null &&
            transcript(tabBody(container, tab)) !== null,
        ),
      "both transcripts",
    );
    await painted();

    const scroller = transcript(tabBody(container, left.tab));

    if (scroller === null) throw new Error("Expected the left transcript");
    await readTo(scroller, 600);

    const kept = [left.tab, right.tab].flatMap((tab) => {
      const body = tabBody(container, tab);

      return [body, transcript(body)];
    });

    const scrollTop = scroller.scrollTop;
    const readingRow = topRow(scroller);

    const step = async (
      name: string,
      actions: readonly LayoutAction<PaneContent>[],
    ): Promise<Step> => {
      window.nyteWorkCounts = {};
      store.dispatch(...actions);
      await painted();
      await painted();
      const counts = window.nyteWorkCounts;

      const now = [left.tab, right.tab].flatMap((tab) => {
        const body = tabBody(container, tab);

        return [body, transcript(body)];
      });

      return {
        name,
        sameElements: now.every((element, index) => element !== null && element === kept[index]),
        scrollTop: scroller.scrollTop,
        topRow: topRow(scroller),
        order: Array.from(container.querySelectorAll<HTMLElement>("[data-nyte-pane-tab]")).map(
          (body) => (body.getAttribute("data-nyte-pane-tab") === left.tab ? "left" : "right"),
        ),
        commits: {
          "render:conversation": counts["render:conversation"] ?? 0,
          "render:transcript-row": counts["render:transcript-row"] ?? 0,
          "render:composer": counts["render:composer"] ?? 0,
        },
      };
    };

    const split = store.getSnapshot().root;

    if (split.kind !== "split") throw new Error("Expected a split");

    const steps = [
      await step("focus", [{ kind: "focus", pane: left.pane }]),
      await step("resize", [
        {
          kind: "resize",
          split: split.id,
          sizes: [
            { kind: "share", share: 0.35 },
            { kind: "share", share: 0.65 },
          ],
        },
      ]),
      await step("zoom", [{ kind: "zoom", pane: right.pane }]),
      await step("unzoom", [{ kind: "zoom", pane: null }]),
      await step("move", [
        {
          kind: "move",
          tab: left.tab,
          place: { kind: "edge", pane: right.pane, direction: "right", side: "after" },
        },
      ]),
    ];

    return JSON.stringify({ scrollTop, topRow: readingRow, steps });
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

export function run(): Promise<string> {
  const watchdog = new Promise<string>((resolve) =>
    window.setTimeout(() => resolve("timed out"), 40_000),
  );

  return Promise.race([
    checkLayout().catch((error: unknown) =>
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    ),
    watchdog,
  ]);
}

applyDisplayMode("light");
