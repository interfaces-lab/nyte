import { asId } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import { createTransport } from "@nyte-ai/protocol";
import type { SseFrame } from "@nyte-ai/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createLink, createRows } from "../src/rows.ts";

afterEach(() => vi.useRealTimers());

const revision: SseFrame = {
  id: null,
  data: { kind: "revision", head: "main", tip: null, revision: "current" },
};

const first: SseFrame = {
  id: "1",
  data: { kind: "head", seq: 1, at: 0, head: "main", from: null, to: null, reason: "created" },
};

const later: SseFrame = {
  id: "2",
  data: { kind: "head", seq: 2, at: 0, head: "main", from: null, to: null, reason: "moved" },
};

const caughtUp: SseFrame = {
  id: null,
  data: { kind: "activation", seq: 0, at: 0, head: null, activation: { kind: "active" } },
};

it.each([
  { name: "a new durable event", recovered: later },
  { name: "the live catch-up marker", recovered: caughtUp },
])("keeps a stalled replay reconnecting until $name arrives", async ({ recovered }) => {
  vi.useFakeTimers();
  const link = createLink();
  const transport = createTransport({ url: "http://unused.test", headers: async () => ({}) });
  const attempts = [[first], [revision, first], [revision], [revision, recovered], [revision]];
  let opened = 0;

  const rows = createRows(
    {
      ...transport,
      watch() {
        const frames = attempts[opened++] ?? [];

        return {
          async *[Symbol.asyncIterator]() {
            yield* frames;
            throw new SdkError("unavailable", "The stream disconnected.");
          },
        };
      },
    },
    link,
  );

  const watching = rows
    .watch("head.watch", { session: asId("session"), head: asId("main") })
    [Symbol.asyncIterator]();

  try {
    expect((await watching.next()).value).toEqual(first.data);
    const second = watching.next();
    await vi.advanceTimersByTimeAsync(50);
    expect((await second).value).toEqual(revision.data);
    expect(link.current()).toMatchObject({ kind: "reconnecting", attempts: 1 });
    expect((await watching.next()).value).toEqual(first.data);
    expect(link.current()).toMatchObject({ kind: "reconnecting", attempts: 1 });

    let returned = false;

    const third = watching.next().then((value) => {
      returned = true;

      return value;
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(link.current()).toMatchObject({ kind: "reconnecting", attempts: 2 });
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await third).value).toEqual(revision.data);
    expect(link.current()).toMatchObject({ kind: "reconnecting", attempts: 2 });

    const fourth = watching.next();
    await vi.advanceTimersByTimeAsync(500);
    expect((await fourth).value).toEqual(revision.data);
    expect(link.current()).toMatchObject({ kind: "reconnecting", attempts: 3 });
    expect((await watching.next()).value).toEqual(recovered.data);
    expect(link.current()).toEqual({ kind: "connected" });

    const fifth = watching.next();
    await vi.advanceTimersByTimeAsync(50);
    expect((await fifth).value).toEqual(revision.data);
    expect(link.current()).toMatchObject({ kind: "reconnecting", attempts: 1 });
  } finally {
    await watching.return?.();
    link.close("client");
  }
});

it("restores a watch that has no durable event IDs", async () => {
  vi.useFakeTimers();
  const link = createLink();
  const transport = createTransport({ url: "http://unused.test", headers: async () => ({}) });
  let opened = 0;

  const rows = createRows(
    {
      ...transport,
      watch() {
        opened += 1;
        const failed = opened === 1;

        return {
          async *[Symbol.asyncIterator]() {
            if (failed) throw new SdkError("unavailable", "The stream disconnected.");
            yield { id: null, data: [] };
          },
        };
      },
    },
    link,
  );

  const watching = rows
    .watch("jobs.watch", { workspace: asId("workspace") })
    [Symbol.asyncIterator]();

  try {
    const next = watching.next();
    await vi.advanceTimersByTimeAsync(50);
    expect(await next).toEqual({ done: false, value: [] });
    expect(link.current()).toEqual({ kind: "connected" });
  } finally {
    await watching.return?.();
    link.close("client");
  }
});
