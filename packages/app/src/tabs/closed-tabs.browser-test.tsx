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
import { createAppRouter } from "../shell/routes.tsx";
import { tabPlace, tabPlaces } from "./model.ts";
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
  flushSync(() => root.unmount());
  container.remove();

  return JSON.stringify({ kept });
}
