import "../../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ModelCatalogView, SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { HostState } from "../../contract/nyte.ts";
import { installConnection } from "../../data/connection.ts";
import { keys, queryClient } from "../../data/query-client.ts";
import { PaneControllerProvider } from "../../panes/pane-context.tsx";
import { SessionDndProvider } from "../../panes/session-dnd.tsx";
import { SessionScreen } from "../../panes/session-screen.tsx";
import { createAppRouter } from "../../shell/routes.tsx";
import { tabPlace } from "../../tabs/model.ts";
import { windowTabs } from "../../tabs/window-tabs.ts";
import { scriptedConnection } from "../../../test/scripted-connection.ts";
import { sessionRow, sessionView } from "../../../test/view-fixtures.ts";

const first = sessionRow("preview-first", { name: "First" });

const second = sessionRow("preview-second", { name: "Second" });

const sends: SessionId[] = [];

const refuse = async (): Promise<never> => {
  throw new Error("Not scripted.");
};

installConnection(
  scriptedConnection({
    sessions: [first, second],
    views: new Map([
      [first.id, [sessionView()]],
      [second.id, [sessionView()]],
    ]),
    session: (id) => ({
      send: async () => {
        sends.push(id);

        return {
          id: asId<"receipt">("sent"),
          message: asId<"message">("sent"),
          status: refuse,
          settled: refuse,
          stop: refuse,
          landed: () => new Promise(() => undefined),
        };
      },
    }),
  }).connection,
);

let renderFailure: unknown;

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (renderFailure !== undefined) throw renderFailure;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

function tabs(): string {
  return windowTabs
    .getSnapshot()
    .tabs.map((tab) => {
      const place = tabPlace(tab);
      const shown = place.kind === "session" ? place.sessionId : place.kind;

      return tab.view.kind === "preview" ? `${shown} (preview)` : shown;
    })
    .join(", ");
}

export async function run(): Promise<string> {
  windowTabs.start({ id: "preview-send", launch: undefined });
  windowTabs.openChat(first.id, "preview");

  queryClient.setQueryData(keys.host, { workspace: undefined } satisfies HostState);
  queryClient.setQueryData(keys.modelCatalog("initial"), {
    generation: asId<"catalog-generation">("initial"),
    providers: [],
    default: { provider: "test", id: "test" },
  } satisfies ModelCatalogView);
  queryClient.setQueryData(keys.mentionFiles, []);

  const container = document.createElement("div");
  container.style.cssText = "position:relative;display:flex;width:760px;height:560px;";
  document.body.append(container);

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/${first.id}`] }),
  });

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
            <PaneControllerProvider>
              <SessionDndProvider>
                <SessionScreen />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  const editor = (): HTMLElement | null =>
    container.querySelector<HTMLElement>("[aria-multiline][aria-label='Message']");

  await until(() => editor() !== null, "the composer");
  await painted();
  editor()?.focus();
  document.execCommand("insertText", false, "Keep going.");
  await painted();
  const typed = tabs();

  container.querySelector<HTMLButtonElement>("button[aria-label='Send message']")?.click();
  await until(() => sends.length > 0, "the send");
  await painted();
  const sent = tabs();

  windowTabs.openChat(second.id, "preview");
  const replaced = tabs();
  root.unmount();

  return JSON.stringify({ typed, sent, replaced });
}
