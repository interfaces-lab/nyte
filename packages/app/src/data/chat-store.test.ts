import { asId, SdkError } from "@nyte-ai/schema";
import type { PartView } from "@nyte-ai/schema";
import type { ChatSnapshot, Freshness, HeadView } from "@nyte-ai/sdk/client";
import type { SessionView } from "@nyte-ai/sdk";
import { expect, test, vi } from "vitest";
import { heldSessions, nextExpiry, nextHolds, NO_HOLDS } from "./chat-holds.ts";
import { chatStore, keepChat, showChat, showPart, warmSession } from "./chat-store.ts";
import type { ChatView, ShownPart } from "./chat-store.ts";
import type { SessionActivity } from "./session-activity.ts";
import { installScripted, scriptedConnection } from "../../test/scripted-connection.ts";
import type { ViewStream } from "../../test/scripted-connection.ts";
import { sessionView, settledTool } from "../../test/view-fixtures.ts";

vi.useFakeTimers();

type Step =
  | { readonly kind: "keep" | "warm"; readonly names: string }
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "replace" };

const NAMES = "abcdefghix";

const GONE = "x";

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
      installScripted(
        scriptedConnection({
          views: new Map(
            NAMES.split("")
              .filter((name) => name !== GONE)
              .map((name) => [id(name), [sessionView()]]),
          ),
        }),
      );

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
    name: "a kept chat the host no longer has is released",
    steps: [{ kind: "keep", names: "axb" }],
    held: "ab",
  },
  {
    name: "a warm chat the host no longer has is released",
    steps: [{ kind: "warm", names: "xa" }],
    held: "a",
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

test.each(ROWS)("through keepChat and warmSession: $name", async (row) => {
  run({ kind: "replace" });
  run({ kind: "wait", ms: 5_000 });

  for (const step of row.steps) run(step);
  await vi.advanceTimersByTimeAsync(0);

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
          .reduce(
            (inner, name) =>
              nextHolds(
                inner,
                name === GONE
                  ? { kind: "gone", session: id(name) }
                  : { kind: "keep", session: id(name) },
              ),
            current,
          );
      case "warm":
        return step.names
          .split("")
          .reduce(
            (inner, name) =>
              nextHolds(
                inner,
                name === GONE
                  ? { kind: "gone", session: id(name) }
                  : { kind: "warm", session: id(name), now },
              ),
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

const head: HeadView = sessionView();

const EXPIRED = [asId<"message">("expired")];

test.each<{
  readonly name: string;
  readonly snapshot: ChatSnapshot;
  readonly shown:
    | "waiting"
    | "failed"
    | (Pick<ChatView, "seq" | "freshness" | "expired" | "stopping"> & {
        readonly activity: SessionActivity["kind"];
      });
}>([
  {
    name: "no view yet while fresh waits",
    snapshot: { view: null, seq: 0, freshness: FRESH, expired: [], stopping: "no" },
    shown: "waiting",
  },
  {
    name: "no view yet while stale without an error waits",
    snapshot: { view: null, seq: 0, freshness: STALE, expired: [], stopping: "no" },
    shown: "waiting",
  },
  {
    name: "no view yet with a stale error fails",
    snapshot: { view: null, seq: 0, freshness: FAILED, expired: [], stopping: "no" },
    shown: "failed",
  },
  {
    name: "a view shows with the chat's seq, freshness, expired sends, stop and activity",
    snapshot: { view: head, seq: 4, freshness: STALE, expired: EXPIRED, stopping: "asked" },
    shown: { seq: 4, freshness: STALE, expired: EXPIRED, stopping: "asked", activity: "idle" },
  },
])("showChat: $name", (row) => {
  const shown = showChat(row.snapshot, () => ({ kind: "idle" }));

  if (row.shown === "waiting" || row.shown === "failed") {
    expect(shown.kind).toBe(row.shown);

    return;
  }

  expect(shown.kind === "shown" && shown.value.messages === head.messages).toBe(true);
  expect(
    shown.kind === "shown"
      ? {
          seq: shown.value.seq,
          freshness: shown.value.freshness,
          expired: shown.value.expired,
          stopping: shown.value.stopping,
          activity: shown.value.activity.kind,
        }
      : shown.kind,
  ).toEqual(row.shown);
});

function unread(): ViewStream {
  let latest: SessionView | undefined;
  const listeners = new Set<() => void>();

  return {
    latest: () => latest,
    push(view) {
      latest = view;

      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    watch: async function* () {},
  };
}

const HELD = sessionView({
  messages: Array.from({ length: 200 }, (_, index) =>
    settledTool(`m${String(index)}`, { kind: "read", path: "a.ts" }),
  ),
});

test.each<{
  readonly name: string;
  readonly host: string;
  readonly shown: { readonly messages: number; readonly freshness: string } | undefined;
  readonly tail: number;
}>([
  {
    name: "a new connection to the same host keeps the chat shown, stale, and opens with the tail it held",
    host: "scripted",
    shown: { messages: 200, freshness: "stale" },
    tail: 200,
  },
  {
    name: "a connection to another host clears the chat and opens with the first tail",
    host: "other",
    shown: undefined,
    tail: 40,
  },
])("replacing the connection: $name", async (row) => {
  const session = asId<"session">(`replaced-${row.host}`);
  installScripted(scriptedConnection({ views: new Map([[session, [HELD]]]) }));
  const store = chatStore(session);
  const leave = store.subscribe(() => undefined);
  await vi.advanceTimersByTimeAsync(0);
  const before = store.value?.messages.length;

  const next = unread();
  const tails: (number | undefined)[] = [];
  const scripted = scriptedConnection({ views: new Map([[session, next]]) }).connection;

  installScripted({
    connection: {
      ...scripted,
      hostId: asId<"host">(row.host),
      chat(id, options) {
        tails.push(options?.tail);

        return scripted.chat(id, options);
      },
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  const value = store.value;

  const waiting =
    value === undefined
      ? undefined
      : { messages: value.messages.length, freshness: value.freshness.kind };

  next.push(sessionView({ messages: HELD.messages.slice(-3) }));
  await vi.advanceTimersByTimeAsync(0);

  expect({ before, waiting, tails, landed: store.value?.freshness.kind }).toEqual({
    before: 200,
    waiting: row.shown,
    tails: [row.tail],
    landed: "fresh",
  });
  leave();
  await vi.advanceTimersByTimeAsync(0);
});
