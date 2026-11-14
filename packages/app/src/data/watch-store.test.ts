import { expect, test, vi } from "vitest";
import { WatchStore } from "./watch-store.ts";
import type { LiveView, Shown } from "./watch-store.ts";
import { viewStream } from "../../test/scripted-connection.ts";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test.each<{
  readonly name: string;
  readonly watched: boolean;
  readonly accept: (value: number, seen: number | undefined) => boolean;
  readonly pushes: readonly (number | Error)[];
  /** Settled before the first push. */
  readonly early: boolean;
  readonly outcome: string;
}>([
  {
    name: "a current value the wait takes resolves it before anything else arrives",
    watched: true,
    accept: () => true,
    pushes: [2],
    early: true,
    outcome: "1",
  },
  {
    name: "a value the same as the one seen is skipped",
    watched: true,
    accept: (value, seen) => value !== seen,
    pushes: [1, 2],
    early: false,
    outcome: "2",
  },
  {
    name: "a value the wait refuses is skipped",
    watched: true,
    accept: (value) => value > 2,
    pushes: [2, 3],
    early: false,
    outcome: "3",
  },
  {
    name: "the store's next error rejects the wait",
    watched: true,
    accept: (value) => value > 5,
    pushes: [new Error("gone")],
    early: false,
    outcome: "rejected: gone",
  },
  {
    name: "a wait on a store nobody watches starts it and takes its first value",
    watched: false,
    accept: () => true,
    pushes: [],
    early: true,
    outcome: "1",
  },
])("$name", async (row) => {
  const stream = viewStream<number | Error>(1);

  const store = new WatchStore<number>(() => ({
    values: (async function* () {
      for await (const value of stream.watch()) {
        if (value instanceof Error) throw value;
        yield value;
      }
    })(),
    ended: "reopen",
  }));

  const leave = row.watched ? store.subscribe(() => undefined) : () => undefined;

  if (row.watched) await settle();
  const seen = store.value;

  const waited = store
    .until((value) => row.accept(value, seen))
    .then(
      (value) => String(value),
      (cause: unknown) => `rejected: ${cause instanceof Error ? cause.message : String(cause)}`,
    );

  const early = await Promise.race([waited.then(() => true), settle().then(() => false)]);

  for (const push of row.pushes) {
    stream.push(push);
    await settle();
  }

  expect({ early, outcome: await waited }).toEqual({
    early: row.early,
    outcome: row.outcome,
  });
  leave();
});

/** A source a store opens: each opening reads `script` from where the last left off; a stream ends after its values, and a live source moves to its next step when `step` is called. */
function opener(source: "finished" | "reopen" | "live", script: readonly (number | Error)[]) {
  const log = { opens: 0, closes: 0 };
  let at = 0;
  const listeners = new Set<() => void>();

  const open = ():
    | LiveView<number>
    | { values: AsyncIterable<number>; ended: "finished" | "reopen" } => {
    log.opens += 1;

    if (source !== "live")
      return {
        values: (async function* () {
          const value = script[at];
          at += 1;

          if (value !== undefined && !(value instanceof Error)) yield value;
        })(),
        ended: source,
      };

    return {
      subscribe(listener) {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
      show(previous): Shown<number> {
        const step = script[at];

        if (step === undefined) return { kind: "waiting" };

        if (step instanceof Error) return { kind: "failed", error: step };

        return step === previous
          ? { kind: "shown", value: previous }
          : { kind: "shown", value: step };
      },
      close() {
        log.closes += 1;
      },
    };
  };

  const step = (): void => {
    at += 1;

    for (const listener of listeners) listener();
  };

  return { open, step, log };
}

test.each<{
  readonly name: string;
  readonly source: "finished" | "reopen" | "live";
  readonly script: readonly (number | Error)[];
  /** Live steps taken after the store opens. */
  readonly steps: number;
  readonly outcome: {
    readonly opens: number;
    readonly closes: number;
    readonly value: number | undefined;
    readonly error: string | undefined;
  };
}>([
  {
    name: "a stream that ends as finished keeps its value and opens no more while held",
    source: "finished",
    script: [1, 2],
    steps: 0,
    outcome: { opens: 1, closes: 0, value: 1, error: undefined },
  },
  {
    name: "a stream that ends as reopen opens again 1 s after each end, doubling while it ends empty",
    source: "reopen",
    script: [1, 2],
    steps: 0,
    outcome: { opens: 4, closes: 0, value: 2, error: undefined },
  },
  {
    name: "a live source's failed first read shows its error and stays open for the source to retry",
    source: "live",
    script: [new Error("gone")],
    steps: 0,
    outcome: { opens: 1, closes: 0, value: undefined, error: "gone" },
  },
  {
    name: "a live source that recovers after a failed first read shows its value without reopening",
    source: "live",
    script: [new Error("gone"), 7],
    steps: 1,
    outcome: { opens: 1, closes: 0, value: 7, error: undefined },
  },
])("$name", async (row) => {
  vi.useFakeTimers();
  const source = opener(row.source, row.script);
  const store = new WatchStore<number>(source.open);
  const leave = store.subscribe(() => undefined);
  await vi.advanceTimersByTimeAsync(0);

  for (let index = 0; index < row.steps; index += 1) {
    source.step();
    await vi.advanceTimersByTimeAsync(0);
  }

  await vi.advanceTimersByTimeAsync(4_000);

  expect({
    opens: source.log.opens,
    closes: source.log.closes,
    value: store.value,
    error: store.error?.message,
  }).toEqual(row.outcome);
  leave();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
});
