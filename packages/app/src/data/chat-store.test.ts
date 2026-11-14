import { asId, SdkError } from "@nyte-ai/schema";
import type { PartView } from "@nyte-ai/schema";
import type { Freshness } from "@nyte-ai/sdk/client";
import { expect, test, vi } from "vitest";
import { heldSessions, nextExpiry, nextHolds, NO_HOLDS } from "./chat-holds.ts";
import { chatStore, keepChat, showPart, warmSession } from "./chat-store.ts";
import type { ShownPart } from "./chat-store.ts";
import { installScripted, scriptedConnection } from "../../test/scripted-connection.ts";

vi.useFakeTimers();

type Step =
  | { readonly kind: "keep" | "warm"; readonly names: string }
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "replace" };

const NAMES = "abcdefghi";

const id = (name: string) => asId<"session">(`hold-${name}`);

function run(step: Step): void {
  switch (step.kind) {
    case "keep":
      for (const name of step.names.split("")) keepChat(id(name));

      return;
    case "warm":
      for (const name of step.names.split("")) warmSession(id(name));

      return;
    case "wait":
      vi.advanceTimersByTime(step.ms);

      return;
    case "replace":
      installScripted(scriptedConnection());

      return;
    default: {
      const exhaustive: never = step;

      return exhaustive;
    }
  }
}

const ROWS: readonly {
  readonly name: string;
  readonly steps: readonly Step[];
  readonly held: string;
}[] = [
  {
    name: "the 9th kept chat releases the oldest",
    steps: [{ kind: "keep", names: "abcdefghi" }],
    held: "bcdefghi",
  },
  {
    name: "keeping a chat again makes it the newest",
    steps: [
      { kind: "keep", names: "abcdefgh" },
      { kind: "keep", names: "a" },
      { kind: "keep", names: "i" },
    ],
    held: "acdefghi",
  },
  {
    name: "the 4th warm chat releases the oldest warm one",
    steps: [{ kind: "warm", names: "abcd" }],
    held: "bcd",
  },
  {
    name: "a warm chat is still held at 4,999 ms",
    steps: [
      { kind: "warm", names: "a" },
      { kind: "wait", ms: 4_999 },
    ],
    held: "a",
  },
  {
    name: "a warm chat is released at 5,000 ms",
    steps: [
      { kind: "warm", names: "a" },
      { kind: "wait", ms: 5_000 },
    ],
    held: "",
  },
  {
    name: "warming a chat again restarts its 5 s",
    steps: [
      { kind: "warm", names: "a" },
      { kind: "wait", ms: 3_000 },
      { kind: "warm", names: "a" },
      { kind: "wait", ms: 4_999 },
    ],
    held: "a",
  },
  {
    name: "a chat warmed again is released 5 s after the last warm",
    steps: [
      { kind: "warm", names: "a" },
      { kind: "wait", ms: 3_000 },
      { kind: "warm", names: "a" },
      { kind: "wait", ms: 5_000 },
    ],
    held: "",
  },
  {
    name: "warming a chat again does not count it twice",
    steps: [{ kind: "warm", names: "abca" }],
    held: "abc",
  },
  {
    name: "a kept and warm chat stays held when its warm hold lapses",
    steps: [
      { kind: "keep", names: "a" },
      { kind: "warm", names: "a" },
      { kind: "wait", ms: 5_000 },
    ],
    held: "a",
  },
  {
    name: "a kept and warm chat stays held when newer chats push it out of the kept ones",
    steps: [
      { kind: "warm", names: "a" },
      { kind: "keep", names: "abcdefghi" },
    ],
    held: "abcdefghi",
  },
  {
    name: "a kept and warm chat is released once both holds lapse",
    steps: [
      { kind: "warm", names: "a" },
      { kind: "keep", names: "abcdefghi" },
      { kind: "wait", ms: 5_000 },
    ],
    held: "bcdefghi",
  },
  {
    name: "a replaced connection releases the kept chats",
    steps: [{ kind: "keep", names: "ab" }, { kind: "replace" }],
    held: "",
  },
  {
    name: "a replaced connection leaves the warm chats held",
    steps: [{ kind: "warm", names: "ab" }, { kind: "replace" }],
    held: "ab",
  },
];

test.each(ROWS)("through keepChat and warmSession: $name", (row) => {
  run({ kind: "replace" });
  run({ kind: "wait", ms: 5_000 });

  for (const step of row.steps) run(step);

  expect(
    NAMES.split("")
      .filter((name) => chatStore(id(name)).active)
      .join(""),
  ).toBe(row.held);
});

test.each(ROWS)("through nextHolds: $name", (row) => {
  let now = 0;

  const holds = row.steps.reduce((current, step) => {
    switch (step.kind) {
      case "keep":
        return step.names
          .split("")
          .reduce((inner, name) => nextHolds(inner, { kind: "keep", session: id(name) }), current);
      case "warm":
        return step.names
          .split("")
          .reduce(
            (inner, name) => nextHolds(inner, { kind: "warm", session: id(name), now }),
            current,
          );
      case "wait":
        now += step.ms;

        return nextHolds(current, { kind: "tick", now });
      case "replace":
        return nextHolds(current, { kind: "replaced" });
      default: {
        const exhaustive: never = step;

        return exhaustive;
      }
    }
  }, NO_HOLDS);

  expect(
    NAMES.split("")
      .filter((name) => heldSessions(holds).has(id(name)))
      .join(""),
  ).toBe(row.held);
  expect(nextExpiry(holds)).toBe(
    holds.warm.length === 0 ? null : Math.min(...holds.warm.map((hold) => hold.until)),
  );
});

function partView(version: number): PartView {
  return {
    id: asId<"part">("part"),
    partKind: "tool",
    placement: { kind: "modal" },
    state: null,
    version,
    status: { kind: "live", run: asId<"run">("run") },
    owner: null,
  };
}

const FRESH: Freshness = { kind: "fresh", seq: 1 };

const STALE: Freshness = { kind: "stale", since: 7, error: null };

const FAILED: Freshness = { kind: "stale", since: 7, error: new SdkError("unknown", "No part") };

const one = partView(1);

const before: ShownPart = { part: one, staleSince: null };

test.each<{
  readonly name: string;
  readonly part: PartView | null | undefined;
  readonly freshness: Freshness;
  readonly previous: ShownPart | undefined;
  readonly shown: "waiting" | "failed" | "previous" | ShownPart;
}>([
  {
    name: "no part yet while fresh waits",
    part: undefined,
    freshness: FRESH,
    previous: undefined,
    shown: "waiting",
  },
  {
    name: "no part yet while stale without an error waits",
    part: undefined,
    freshness: STALE,
    previous: undefined,
    shown: "waiting",
  },
  {
    name: "no part yet with a stale error fails",
    part: undefined,
    freshness: FAILED,
    previous: undefined,
    shown: "failed",
  },
  {
    name: "a part shows with no stale time while fresh",
    part: one,
    freshness: FRESH,
    previous: undefined,
    shown: before,
  },
  {
    name: "a part the host removed shows as none",
    part: null,
    freshness: FRESH,
    previous: before,
    shown: { part: null, staleSince: null },
  },
  {
    name: "the same part while still fresh keeps what was shown",
    part: one,
    freshness: FRESH,
    previous: before,
    shown: "previous",
  },
  {
    name: "the part shown before stays while the store has none and is stale",
    part: undefined,
    freshness: FAILED,
    previous: before,
    shown: { part: one, staleSince: 7 },
  },
  {
    name: "a new version of the part shows",
    part: partView(2),
    freshness: FRESH,
    previous: before,
    shown: { part: partView(2), staleSince: null },
  },
])("showPart: $name", (row) => {
  const shown = showPart(
    { snapshot: row.part === undefined ? null : { part: row.part }, freshness: row.freshness },
    row.previous,
  );

  if (row.shown === "waiting" || row.shown === "failed") {
    expect(shown.kind).toBe(row.shown);

    return;
  }

  if (row.shown === "previous") {
    expect(shown.kind === "shown" && shown.value === row.previous).toBe(true);

    return;
  }

  expect(shown).toEqual({ kind: "shown", value: row.shown });
});
