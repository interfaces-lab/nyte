import { Tooltip } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { sessionId } from "@nyte-ai/protocol";
import type {
  PluginCatalog,
  RunInfo,
  SessionEvent,
  SessionInfo,
  SessionMetadata,
  SessionSnapshot,
} from "@nyte-ai/protocol";
import type { DesktopCatalog, HostState } from "../nyte.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { ThreadScreen } from "./thread.tsx";
import "../theme/tokens.css";

declare global {
  interface Window {
    threadRenderSnapshot: SessionSnapshot;
    threadRenderMetadata: SessionMetadata;
    threadRenderEmit: ((event: SessionEvent) => void) | undefined;
  }
}

const ID = sessionId("thread-render");
const activeRun = {
  runId: "current-run",
  head: "main",
  origin: { kind: "user" },
  root: "current-run",
  phase: { kind: "respond" },
  startedAt: 0,
  attempts: 0,
  config: {},
} satisfies RunInfo;
const session = {
  sessionId: ID,
  name: "Identity test",
  createdAt: 0,
  lastActivityAt: 0,
  pinned: false,
  archived: false,
  activation: { kind: "active" },
  config: {},
  heads: [{ head: "main", tip: "stable-answer", run: activeRun }],
} satisfies SessionInfo;
const snapshot = {
  seq: 1,
  head: "main",
  tip: "stable-answer",
  config: {},
  pending: [
    {
      change: "pending-change",
      lane: "steer",
      at: 1,
      content: "Pending prompt",
      key: "live",
    },
  ],
  transcript: [
    {
      kind: "turn",
      id: "live",
      run: "settled-run",
      startedAt: 0,
      durationMs: 1_000,
      parts: [
        {
          kind: "user",
          commit: "stable-user",
          parent: null,
          content: Array.from({ length: 12 }, (_, index) => `Prompt line ${String(index)}`).join(
            "\n",
          ),
        },
        { kind: "thinking", commit: "stable-answer", contentIndex: 0, text: "Stable plan" },
        {
          kind: "assistant",
          commit: "stable-answer",
          contentIndex: 1,
          text: "Stable answer",
        },
      ],
    },
  ],
  context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1_000 },
  session,
  run: activeRun,
} satisfies SessionSnapshot;
const metadata = {
  session,
  head: snapshot.head,
  config: snapshot.config,
  context: snapshot.context,
} satisfies SessionMetadata;
const catalog = {
  source: "local",
  providers: [],
  models: [],
  defaults: { model: { provider: "test", id: "test" }, thinkingLevel: "off" },
} satisfies DesktopCatalog;
const plugins = { plugins: [], commands: [], skills: [], settings: [] } satisfies PluginCatalog;
const host = { workspace: undefined, platform: "linux" } satisfies HostState;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function textNode(container: HTMLElement, text: string): Element | undefined {
  return Array.from(container.querySelectorAll("p, div, span")).find(
    (node) => node.textContent === text,
  );
}

function emit(event: SessionEvent): void {
  const publish = window.threadRenderEmit;
  if (publish === undefined) throw new Error("Thread watch is not ready");
  publish(event);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

export async function runTest(): Promise<string> {
  queryClient.clear();
  window.threadRenderSnapshot = snapshot;
  window.threadRenderMetadata = metadata;
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.session(ID), session);
  queryClient.setQueryData(keys.sessionCatalog(ID), catalog);
  queryClient.setQueryData(keys.childSessions(ID), []);
  queryClient.setQueryData(keys.pluginCatalog, plugins);
  queryClient.setQueryData(keys.mentionFiles, []);
  queryClient.setQueryData(keys.jobs(ID), []);

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [`/session/${ID}`] }),
  });
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:700px";
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <Tooltip.Provider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider workspaceKey="thread-render-test">
              <SessionDndProvider>
                <ThreadScreen routeSessionId={ID} />
              </SessionDndProvider>
            </PaneControllerProvider>
          </Tooltip.Provider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  try {
    await until(() => textNode(container, "Pending prompt") !== undefined, "the landing row");
    await until(() => window.threadRenderEmit !== undefined, "the thread watch");
    const pending =
      textNode(container, "Pending prompt")?.closest<HTMLDivElement>("[data-index]") ?? undefined;
    if (pending === undefined) throw new Error("The landing message has no transcript row");

    emit({
      kind: "commit",
      head: "main",
      seq: 2,
      item: {
        oid: "landed-user",
        commit: {
          kind: "commit",
          parent: "stable-answer",
          run: activeRun.runId,
          change: "pending-change",
          key: "live",
          at: 2,
          body: {
            kind: "message",
            message: { role: "user", content: "Pending prompt", timestamp: 2 },
          },
        },
      },
    });
    await until(
      () => pending.querySelector("[data-sticky-turn]")?.getAttribute("title") === null,
      "the landing message to settle",
    );
    check(
      textNode(container, "Pending prompt")?.closest("[data-index]") === pending,
      "The landed message replaced its transcript row",
    );

    const completedRun = {
      ...activeRun,
      attempts: 1,
      phase: { kind: "done" },
    } satisfies RunInfo;
    emit({ kind: "run", head: "main", seq: 3, run: completedRun });
    await until(
      () =>
        Array.from(container.querySelectorAll("button")).some((button) =>
          button.textContent?.includes("Worked"),
        ),
      "the run to settle",
    );
    await until(
      () =>
        Array.from(container.querySelectorAll("button")).some(
          (button) => button.textContent?.trim() === "Show more",
        ),
      "the settled message disclosure",
    );
    const stable = textNode(container, "Stable answer")?.closest<HTMLDivElement>("[data-index]");
    const disclosure = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Show more",
    );
    check(stable !== undefined, "The settled answer has a transcript row");
    if (disclosure === undefined) throw new Error("The settled message has no disclosure");
    disclosure.click();
    await until(() => disclosure.textContent?.trim() === "Show less", "the message to expand");

    for (let index = 0; index < 20; index += 1) {
      emit({
        kind: "text_delta",
        seq: index + 4,
        runId: activeRun.runId,
        attempt: 1,
        index: 0,
        delta: String(index),
      });
      await nextFrame();
      await nextFrame();
    }

    check(
      textNode(container, "Stable answer")?.closest("[data-index]") === stable,
      "Live deltas replaced a settled transcript row",
    );
    const expandedDisclosure = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Show less",
    );
    if (expandedDisclosure === undefined)
      throw new Error("Live deltas collapsed the settled message");
    check(
      expandedDisclosure.getAttribute("aria-expanded") === "true",
      "Live deltas reset the message fold",
    );
    return "passed";
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

export const run = runTest;
