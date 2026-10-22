import "../test/window-bridge.ts";
import type { ReactElement } from "react";
import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { SessionInfo } from "@nyte-ai/sdk";
import { scriptedConnection, viewStream } from "../test/scripted-connection.ts";
import { sessionRow } from "../test/view-fixtures.ts";
import { liveRun } from "./screens/session-screen-render.fixtures.ts";
import { useWorkingSessionIds } from "./queries.ts";
import { installConnection, sessionsWatch } from "./sdk.tsx";

const rootA = sessionRow("root-a");
const rootB = sessionRow("root-b");
const middle = sessionRow("middle", { parent: rootA.id });
const active = sessionRow(
  "active",
  { parent: middle.id },
  { kind: "live", run: liveRun, phase: "responding", stopping: false },
);
const idle = sessionRow("idle", { parent: rootB.id });
const source = viewStream<readonly SessionInfo[]>([rootA, rootB, middle, active, idle]);

installConnection(scriptedConnection({ sessions: source }).connection);

let commits = 0;

function WorkingAncestors(): ReactElement {
  const working = useWorkingSessionIds();
  useLayoutEffect(() => {
    commits += 1;
  });

  return <output>{[...working].sort().join(",")}</output>;
}

function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export async function run(): Promise<string> {
  const store = sessionsWatch("all");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(<WorkingAncestors />));
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
    await publish("another ancestor starts", [rootB, second, active, middle, rootA]);
    await publish("active directory reorder", [rootA, middle, active, rootB, second]);
    const settled = sessionRow("active", { parent: middle.id });
    await publish("first ancestor stops", [rootB, second, settled, middle, rootA]);
    await publish("child changes parent", [
      rootB,
      { ...second, parent: middle.id },
      settled,
      middle,
      rootA,
    ]);
    await publish("last child stops", [rootB, idle, settled, middle, rootA]);

    return JSON.stringify({ loading, updates: report });
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    store.dispose();
  }
}
