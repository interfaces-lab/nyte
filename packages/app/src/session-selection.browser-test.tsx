import "./conversation/transcript-render-counter.ts";
import "../test/window-bridge.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import type { SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { queryClient, useSession } from "./queries.ts";
import { installConnection } from "./sdk.tsx";
import { scriptedConnection, viewStream } from "../test/scripted-connection.ts";
import { sessionRow } from "../test/view-fixtures.ts";
import { renderCount, resetRenders } from "./conversation/transcript-render-counter.ts";

const SHOWN = asId<"session">("shown");

const UNLISTED = asId<"session">("unlisted");

const SNAPSHOTS = 50;

function directory(shownName: string, otherName: string): readonly SessionInfo[] {
  return [sessionRow("shown", { name: shownName }), sessionRow("other", { name: otherName })];
}

const sessions = viewStream(directory("Shown", "Other"));

installConnection(
  scriptedConnection({
    sessions,
    session: (id) => ({
      info: async () => sessionRow(id, { name: id === UNLISTED ? "Read from host" : null }),
    }),
  }).connection,
);

function ShownTitle(): ReactElement {
  const name = useSession(SHOWN, (session) => session.name).data;

  return <span data-title="shown">{name ?? "New chat"}</span>;
}

function ShownRow(): null {
  useSession(SHOWN);

  return null;
}

function UnlistedTitle(): ReactElement {
  const name = useSession(UNLISTED, (session) => session.name).data;

  return <span data-title="unlisted">{name === undefined ? "Loading" : (name ?? "Missing")}</span>;
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
    await painted();
  }
}

export async function run(): Promise<string> {
  queryClient.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const title = (which: string): string | null | undefined =>
    container.querySelector(`[data-title="${which}"]`)?.textContent;

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ShownTitle />
        <ShownRow />
        <UnlistedTitle />
      </QueryClientProvider>,
    ),
  );

  try {
    await until(() => title("shown") === "Shown", "the listed title");
    await until(() => title("unlisted") === "Read from host", "the unlisted title");

    for (let index = 0; index < 5; index += 1) await painted();
    resetRenders(ShownTitle);
    resetRenders(ShownRow);
    resetRenders(UnlistedTitle);

    for (let index = 0; index < SNAPSHOTS; index += 1) {
      sessions.push(directory("Shown", `Other ${String(index)}`));
      await painted();
    }

    const unrelated = {
      title: renderCount(ShownTitle).updates,
      row: renderCount(ShownRow).updates,
      unlisted: renderCount(UnlistedTitle).updates,
    };

    resetRenders(ShownTitle);
    sessions.push(directory("Renamed", `Other ${String(SNAPSHOTS)}`));
    await until(() => title("shown") === "Renamed", "the renamed title");
    await painted();

    return JSON.stringify({
      snapshots: SNAPSHOTS,
      unrelated,
      renamed: { title: renderCount(ShownTitle).updates, text: title("shown") },
      unlisted: title("unlisted"),
    });
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}
