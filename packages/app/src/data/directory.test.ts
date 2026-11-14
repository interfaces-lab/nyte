import type { SessionInfo } from "@nyte-ai/sdk";
import type { SessionsSnapshot } from "@nyte-ai/sdk/client";
import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { showSessions } from "./directory.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const a = sessionRow("a");

const b = sessionRow("b");

const shownBefore: readonly SessionInfo[] = [a, b];

function snapshot(ids: readonly string[], rows: readonly SessionInfo[]): SessionsSnapshot {
  return {
    ids: ids.map((id) => asId<"session">(id)),
    rows: new Map(rows.map((row) => [row.id, row])),
  };
}

test.each<{
  readonly name: string;
  readonly snapshot: SessionsSnapshot | null;
  readonly previous: readonly SessionInfo[] | undefined;
  readonly shown: "waiting" | "previous" | readonly string[];
}>([
  { name: "no snapshot yet waits", snapshot: null, previous: undefined, shown: "waiting" },
  {
    name: "the rows show in the window's order",
    snapshot: snapshot(["b", "a"], [a, b]),
    previous: undefined,
    shown: ["b", "a"],
  },
  {
    name: "the same rows in the same order keep the array shown before",
    snapshot: snapshot(["a", "b"], [a, b]),
    previous: shownBefore,
    shown: "previous",
  },
  {
    name: "the same rows reordered are a new array",
    snapshot: snapshot(["b", "a"], [a, b]),
    previous: shownBefore,
    shown: ["b", "a"],
  },
  {
    name: "a changed row is a new array",
    snapshot: snapshot(["a", "b"], [a, sessionRow("b", { name: "renamed" })]),
    previous: shownBefore,
    shown: ["a", "b"],
  },
  {
    name: "an id without a row is skipped",
    snapshot: snapshot(["a", "gone", "b"], [a, b]),
    previous: undefined,
    shown: ["a", "b"],
  },
])("$name", (row) => {
  const shown = showSessions(row.snapshot, row.previous);

  if (row.shown === "waiting") {
    expect(shown).toEqual({ kind: "waiting" });

    return;
  }

  if (row.shown === "previous") {
    expect(shown).toEqual({ kind: "shown", value: row.previous });
    expect(shown.kind === "shown" && shown.value === row.previous).toBe(true);

    return;
  }

  expect(shown.kind === "shown" && shown.value !== row.previous).toBe(true);
  expect(shown.kind === "shown" ? shown.value.map((info) => info.id) : shown.kind).toEqual(
    row.shown,
  );
});
