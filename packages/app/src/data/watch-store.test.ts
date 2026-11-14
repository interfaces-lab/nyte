import { expect, test } from "vitest";
import { WatchStore } from "./watch-store.ts";
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

  const store = new WatchStore<number>(async function* () {
    for await (const value of stream.watch()) {
      if (value instanceof Error) throw value;
      yield value;
    }
  });

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
