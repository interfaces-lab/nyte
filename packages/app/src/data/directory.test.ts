import type { SessionInfo } from "@nyte-ai/sdk";
import type { SessionsSnapshot } from "@nyte-ai/sdk/client";
import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { sessionList, showSessions } from "./directory.ts";
import { installScripted, scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const a = sessionRow("a");

const b = sessionRow("b");

function snapshot(ids: readonly string[], rows: readonly SessionInfo[]): SessionsSnapshot {
  return {
    ids: ids.map((id) => asId<"session">(id)),
    rows: new Map(rows.map((row) => [row.id, row])),
  };
}

test.each<{
  readonly name: string;
  readonly snapshot: SessionsSnapshot | null;
  readonly shown: "waiting" | readonly string[];
}>([
  { name: "no snapshot yet waits", snapshot: null, shown: "waiting" },
  {
    name: "the rows show in the window's order",
    snapshot: snapshot(["b", "a"], [a, b]),
    shown: ["b", "a"],
  },
  {
    name: "an id without a row is skipped",
    snapshot: snapshot(["a", "gone", "b"], [a, b]),
    shown: ["a", "b"],
  },
])("$name", (row) => {
  const shown = showSessions(row.snapshot);

  expect(shown.kind === "shown" ? shown.value.map((info) => info.id) : shown.kind).toEqual(
    row.shown,
  );
});

test.each<{
  readonly name: string;
  readonly next: (shown: readonly SessionInfo[]) => readonly SessionInfo[];
  readonly kept: boolean;
}>([
  {
    name: "the same snapshot heard again keeps the array shown",
    next: (shown) => shown,
    kept: true,
  },
  {
    name: "a changed row is a new array",
    next: () => [a, sessionRow("b", { name: "renamed" })],
    kept: false,
  },
])("through sessionList: $name", async (row) => {
  const lists = viewStream<readonly SessionInfo[]>([a, b]);
  installScripted(scriptedConnection({ sessions: lists }));
  const store = sessionList("roots");
  const leave = store.subscribe(() => undefined);
  const before = await store.until(() => true);
  let heard = 0;

  const count = store.subscribe(() => {
    heard += 1;
  });

  lists.push(row.next(lists.latest() ?? []));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect({ kept: store.value === before, heard }).toEqual({
    kept: row.kept,
    heard: row.kept ? 0 : 1,
  });
  count();
  leave();
});
