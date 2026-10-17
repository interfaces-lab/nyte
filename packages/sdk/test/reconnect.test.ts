import { asId, SdkError } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { createTransport } from "@nyte-ai/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createLink, createRows } from "../src/rows.ts";

afterEach(() => vi.useRealTimers());

it("reports each lost watch and backs off before reopening it, restoring the link on a reopened watch's first frame", async () => {
  vi.useFakeTimers();
  const link = createLink();
  const transport = createTransport({ url: "http://unused.test", headers: async () => ({}) });
  const attempts: Json[][] = [[{ kind: "jobs", jobs: [] }], [], [], [{ kind: "jobs", jobs: [] }]];
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
    expect(link.current()).toEqual({ kind: "connected" });

    let returned = false;

    const second = watching.next().then((value) => {
      returned = true;

      return value;
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(link.current()).toMatchObject({ kind: "reconnecting", attempts: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(link.current()).toMatchObject({ kind: "reconnecting", attempts: 3 });
    await vi.advanceTimersByTimeAsync(499);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await second).toEqual({ done: false, value: { kind: "jobs", jobs: [] } });
    expect(link.current()).toEqual({ kind: "connected" });
    expect(opened).toBe(4);
  } finally {
    await watching.return?.();
    link.close("client");
  }
});
