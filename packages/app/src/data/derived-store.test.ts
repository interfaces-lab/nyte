import { expect, test } from "vitest";
import { derivedStore } from "./derived-store.ts";
import type { StoreSource } from "./derived-store.ts";

function cell<T>(
  initial: T,
): StoreSource<T> & { readonly set: (next: T) => void; readonly heard: () => number } {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    read: () => value,
    subscribe(notice) {
      listeners.add(notice);

      return () => listeners.delete(notice);
    },
    set(next) {
      value = next;

      for (const notice of listeners) notice();
    },
    heard: () => listeners.size,
  };
}

test("a change to any one source reaches the snapshot, and an unchanged read keeps it", () => {
  const left = cell(1);
  const right = cell("a");
  let derived = 0;

  const store = derivedStore(
    { left, right },
    (read) => {
      derived += 1;

      return { sum: `${String(read.left.read())}${read.right.read()}` };
    },
    { sum: "" },
  );

  let notices = 0;

  const leave = store.subscribe(() => {
    notices += 1;
  });

  const first = store.getSnapshot();

  expect(first).toEqual({ sum: "1a" });
  expect(store.getSnapshot()).toBe(first);

  right.set("b");
  expect(store.getSnapshot()).toEqual({ sum: "1b" });
  left.set(2);
  expect(store.getSnapshot()).toEqual({ sum: "2b" });
  left.set(2);
  const settled = store.getSnapshot();
  expect(store.getSnapshot()).toBe(settled);
  expect([notices, derived]).toEqual([3, 3]);

  expect([left.heard(), right.heard()]).toEqual([1, 1]);
  leave();
  expect([left.heard(), right.heard()]).toEqual([0, 0]);
});
