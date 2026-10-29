import "../../test/window-bridge.ts";
import type { ReactElement } from "react";
import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { SessionInfo } from "@nyte-ai/sdk";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";
import { liveRun } from "../panes/session-screen-render.fixtures.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { installConnection } from "../data/connection.ts";
import { sessionsWatch } from "../data/watches.ts";
import { chatTitle, useChat, useChats } from "./index.ts";

/** A row whose main head counts `working` background items. */
function working(row: SessionInfo, count: number): SessionInfo {
  return {
    ...row,
    heads: row.heads.map((head) => ({ ...head, background: { working: count, waiting: 0 } })),
  };
}

const rootA = working(sessionRow("root-a"), 1);

const rootB = sessionRow("root-b");

const middle = sessionRow("middle", { parent: rootA.id });

const active = sessionRow(
  "active",
  { parent: middle.id },
  { kind: "live", run: liveRun, phase: "responding", stopping: false },
);

const idle = sessionRow("idle", { parent: rootB.id });

const started = sessionRow("started", { name: "Just started" });

const source = viewStream<readonly SessionInfo[]>([rootA, rootB, middle, active, idle]);

installConnection(
  scriptedConnection({
    sessions: source,
    session: (id) => (id === started.id ? { info: async () => started } : {}),
  }).connection,
);

let commits = 0;

function RootStatus({ id }: { readonly id: SessionInfo["id"] }): string {
  const chat = useChat(id);
  useLayoutEffect(() => {
    commits += 1;
  });

  return chat.kind === "ready"
    ? `${chat.chat.title}:${chat.chat.status.kind}:${String(chat.chat.background.working)}`
    : chat.kind;
}

function Roots(): ReactElement {
  return (
    <output>
      <RootStatus id={rootA.id} /> <RootStatus id={rootB.id} />
    </output>
  );
}

/** A chat the lists don't carry, as its own reader and the directory each show it. */
function Unlisted(): string {
  const chat = useChat(started.id);
  const listed = useChats((chats) => chatTitle(chats.get(started.id)));

  return `${chat.kind === "ready" ? chat.chat.title : chat.kind} / ${listed}`;
}

function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export async function run(): Promise<string> {
  const store = sessionsWatch("all");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(<Roots />));
  const loading = container.textContent;
  await store.first();
  await painted();
  const report = [{ phase: "initial", shown: container.textContent, commits }];

  const publish = async (phase: string, rows: readonly SessionInfo[]): Promise<void> => {
    commits = 0;
    const received = store.next();
    source.push(rows);
    await received;
    await painted();
    report.push({ phase, shown: container.textContent, commits });
  };

  try {
    await publish("child metadata", [
      rootA,
      rootB,
      middle,
      { ...active, name: "Renamed child", lastActivityAt: 3 },
      idle,
    ]);
    await publish("directory reorder", [rootB, idle, active, middle, rootA]);
    const second = { ...idle, heads: active.heads };
    const busyB = working(rootB, 1);
    await publish("another root starts background work", [busyB, second, active, middle, rootA]);
    await publish("busy directory reorder", [rootA, middle, active, busyB, second]);
    const settled = sessionRow("active", { parent: middle.id });
    const quietA = working(rootA, 0);
    await publish("first root's background work ends", [busyB, second, settled, middle, quietA]);
    await publish("background work moves", [rootB, second, settled, middle, rootA]);
    await publish("last background work ends", [rootB, idle, settled, middle, quietA]);

    const unlisted = document.createElement("div");
    document.body.append(unlisted);
    const other = createRoot(unlisted);
    const seen: (string | null)[] = [];

    const until = async (text: string): Promise<void> => {
      for (let frame = 0; frame < 100 && unlisted.textContent !== text; frame += 1) await painted();
      seen.push(unlisted.textContent);
    };

    flushSync(() => other.render(<Unlisted />));
    await until("Just started / Just started");
    queryClient.setQueryData(keys.session(started.id), { ...started, name: "Renamed" });
    await until("Renamed / Renamed");
    source.push([rootB, idle, settled, middle, quietA, { ...started, name: "Listed" }]);
    await until("Listed / Listed");
    flushSync(() => other.unmount());
    unlisted.remove();

    return JSON.stringify({ loading, updates: report, unlisted: seen });
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    store.dispose();
  }
}
