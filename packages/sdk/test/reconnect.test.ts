import { asId, SdkError } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { createTransport } from "@nyte-ai/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createRows } from "../src/connection/rows.ts";
import { linkCell } from "../src/live/link.ts";

afterEach(() => vi.useRealTimers());

it("waits on the retry curve before reopening a lost watch, and reopens it at once when the link opens", async () => {
  vi.useFakeTimers();
  const link = linkCell();
  const transport = createTransport({ url: "http://unused.test", headers: async () => ({}) });
  const attempts: Json[][] = [[{ kind: "jobs", jobs: [] }], [], [{ kind: "jobs", jobs: [] }]];
  let opened = 0;

  const rows = createRows(
    {
      ...transport,
      frames() {
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
    .watch("jobs.watch", { workspace: asId("workspace") })
    [Symbol.asyncIterator]();

  try {
    expect(await watching.next()).toEqual({ done: false, value: { kind: "jobs", jobs: [] } });
    const second = watching.next();

    await vi.advanceTimersByTimeAsync(124);
    expect(opened).toBe(1);
    await vi.advanceTimersByTimeAsync(126);
    expect(opened).toBe(2);

    link.socket({
      kind: "open",
      since: Date.now(),
      version: "0.0.29",
      startedAt: 0,
      match: { kind: "current" },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(await second).toEqual({ done: false, value: { kind: "jobs", jobs: [] } });
    expect(opened).toBe(3);
  } finally {
    await watching.return?.();
    link.close();
  }
});

it("reopens a watch whose frame it cannot read, and fails when the reopened watch's first frame is unreadable too", async () => {
  const link = linkCell();
  const transport = createTransport({ url: "http://unused.test", headers: async () => ({}) });
  const jobs = { kind: "jobs", jobs: [] };
  const unknown = { kind: "unknown" };
  const attempts: Json[][] = [[jobs, unknown], [jobs, unknown], [unknown]];
  let opened = 0;

  const rows = createRows(
    {
      ...transport,
      frames() {
        const frames = attempts[opened++] ?? [];

        return {
          async *[Symbol.asyncIterator]() {
            yield* frames;
            await new Promise<void>(() => undefined);
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
    expect(await watching.next()).toEqual({ done: false, value: jobs });
    expect(await watching.next()).toEqual({ done: false, value: jobs });
    expect(opened).toBe(2);
    await expect(watching.next()).rejects.toThrow("frames this client cannot read");
    expect(opened).toBe(3);
  } finally {
    await watching.return?.();
    link.close();
  }
});
