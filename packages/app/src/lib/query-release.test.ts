import { resolveObjectURL } from "node:buffer";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, test } from "vitest";
import type { ByteReader } from "@nyte-ai/sdk";
import { releaseWithQuery } from "./query-release.ts";
import { blobUrlQuery } from "./use-blob-url.ts";

function gatedReads() {
  const reads: { readonly gate: () => void; readonly closed: Promise<void> }[] = [];

  const open = async (): Promise<ByteReader> => {
    const gate = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    reads.push({ gate: gate.resolve, closed: closed.promise });

    return {
      size: null,
      mime: "text/plain",
      async *chunks() {
        await gate.promise;
        yield new TextEncoder().encode("bytes");
      },
      close: async () => {},
      [Symbol.asyncDispose]: async () => closed.resolve(),
    };
  };

  return {
    open,
    started: () => reads.length,
    finish: (read: number) => reads[read].gate(),
    closed: (read: number) => reads[read].closed,
  };
}

test("a cancelled read that lands last leaves the current object URL alone", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const reads = gatedReads();
  const query = blobUrlQuery(["blob", "a"], reads.open);
  const observer = new QueryObserver(client, query);
  const unsubscribe = observer.subscribe(() => {});
  await expect.poll(reads.started).toBe(1);

  void client.resetQueries({ queryKey: query.queryKey });
  await expect.poll(reads.started).toBe(2);
  reads.finish(1);
  await expect.poll(() => observer.getCurrentResult().data).toBeDefined();
  const current = observer.getCurrentResult().data ?? "";
  reads.finish(0);
  await reads.closed(0);

  expect(observer.getCurrentResult().data).toBe(current);
  expect(resolveObjectURL(current)).toBeDefined();

  unsubscribe();
  client.clear();
  expect(resolveObjectURL(current)).toBeUndefined();
});

test("each fetch releases what it made once, and only its own", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gates: (() => void)[] = [];
  const released: number[] = [];

  const observer = new QueryObserver(client, {
    queryKey: ["resource"],
    queryFn: async (context) => {
      const made = gates.length;
      const gate = Promise.withResolvers<void>();
      gates.push(gate.resolve);
      await gate.promise;
      releaseWithQuery(context, () => released.push(made));

      return made;
    },
  });

  const unsubscribe = observer.subscribe(() => {});
  await expect.poll(() => gates.length).toBe(1);

  void client.resetQueries({ queryKey: ["resource"] });
  await expect.poll(() => gates.length).toBe(2);
  gates[1]();
  await expect.poll(() => observer.getCurrentResult().data).toBe(1);
  gates[0]();
  await expect.poll(() => released).toEqual([0]);

  void client.refetchQueries({ queryKey: ["resource"] });
  await expect.poll(() => gates.length).toBe(3);
  gates[2]();
  await expect.poll(() => observer.getCurrentResult().data).toBe(2);
  expect(released).toEqual([0, 1]);

  unsubscribe();
  client.clear();
  expect(released).toEqual([0, 1, 2]);
});
