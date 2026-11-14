import "../../test/window-bridge.ts";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { installScripted, scriptedConnection } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";
import { queryClient } from "../data/query-client.ts";
import { closeSettings, showNotifiedChat } from "../settings/return.ts";
import { createAppRouter } from "../shell/routes.tsx";
import { activeTab, tabPlace, tabPlaces } from "./model.ts";
import { useWindowTabsSync } from "./use-window-tabs.tsx";
import { windowTabs } from "./window-tabs.ts";

const quiet = sessionRow("quiet", { name: "Quiet" });

const ARCHIVED = asId<"session">("archived");

const DELETED = asId<"session">("deleted");

const others = Array.from({ length: 50 }, (_, index) => sessionRow(`other-${String(index)}`));

installScripted(
  scriptedConnection({
    sessions: [...others, sessionRow("archived", { archived: true })],
    session: (id) => (id === quiet.id ? { info: async () => quiet } : {}),
  }),
);

function Sync(): null {
  useWindowTabsSync();

  return null;
}

function closedChats(): readonly SessionId[] {
  return windowTabs
    .getSnapshot()
    .closed.flatMap(({ tab }) =>
      tabPlaces(tab).flatMap((place) => (place.kind === "session" ? [place.sessionId] : [])),
    );
}

function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function until(done: () => boolean): Promise<void> {
  for (let frame = 0; frame < 200 && !done(); frame += 1) await painted();
}

const chat = (index: number): SessionId => asId<"session">(`other-${String(index)}`);

type AppRouter = ReturnType<typeof createAppRouter>;

/** What happens while Settings covers the chat in `other-1`, and the chat the window ends on. */
const OVER_SETTINGS: readonly (readonly [string, (router: AppRouter) => void, SessionId])[] = [
  ["a notification shows its chat", () => showNotifiedChat(chat(2)), chat(2)],
  [
    "Settings closes onto the chat a notification opened under it",
    (router) => {
      windowTabs.openChat(chat(3), "permanent");
      closeSettings(router);
    },
    chat(3),
  ],
];

async function overSettings(
  router: AppRouter,
  [name, act, expected]: (typeof OVER_SETTINGS)[number],
): Promise<string> {
  windowTabs.openChat(chat(1), "permanent");
  await until(() => router.history.location.pathname === `/session/${chat(1)}`);
  void router.navigate({ to: "/settings/$section", params: { section: "general" } });
  await until(() => router.state.matches.some((match) => match.routeId === "/settings/$section"));
  act(router);

  for (let frame = 0; frame < 20; frame += 1) await painted();
  const place = tabPlace(activeTab(windowTabs.getSnapshot()));
  const shown = place.kind === "session" ? place.sessionId : place.kind;

  return `${name}: ${router.history.location.pathname}, tab ${shown}${shown === expected ? "" : ` (wanted ${expected})`}`;
}

export async function run(): Promise<string> {
  windowTabs.start({ id: "closed-tabs", launch: undefined });

  for (const id of [quiet.id, ARCHIVED, DELETED, asId<"session">("other-0")])
    windowTabs.openChat(id, "permanent");

  for (const id of [quiet.id, ARCHIVED, DELETED]) {
    const tab = windowTabs.getSnapshot().tabs.find((candidate) => {
      const place = tabPlace(candidate);

      return place.kind === "session" && place.sessionId === id;
    });

    if (tab !== undefined) windowTabs.dispatch({ kind: "close-tab", tabId: tab.id });
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <Sync />
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  for (let frame = 0; frame < 200 && closedChats().join(", ") !== quiet.id; frame += 1)
    await painted();
  const kept = closedChats().join(", ");
  const settings: string[] = [];

  for (const row of OVER_SETTINGS) settings.push(await overSettings(router, row));
  flushSync(() => root.unmount());
  container.remove();

  return JSON.stringify({ kept, settings });
}
