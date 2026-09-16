import { expect, test } from "vitest";
import {
  ChangesViewOptionsStore,
  decodeChangesViewOptions,
  defaultChangesViewOptions,
} from "./changes-view-options.ts";

function memoryStorage(initial?: string): Pick<Storage, "getItem" | "setItem"> & {
  readonly written: () => string | null;
} {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    written: () => value,
  };
}

test("defaults match today's Changes tab", () => {
  expect(defaultChangesViewOptions).toEqual({
    layout: "unified",
    ignoreWhitespace: false,
    wordWrap: true,
  });
  expect(new ChangesViewOptionsStore().options("repo")).toEqual(defaultChangesViewOptions);
});

test("options are kept per scope", () => {
  const store = new ChangesViewOptionsStore();
  store.setOptions("repo-a", { layout: "split", ignoreWhitespace: true });

  expect(store.options("repo-a")).toEqual({
    layout: "split",
    ignoreWhitespace: true,
    wordWrap: true,
  });
  expect(store.options("repo-b")).toEqual(defaultChangesViewOptions);
});

test("options round-trip through storage", () => {
  const storage = memoryStorage();
  const store = new ChangesViewOptionsStore({ storage, now: () => 7 });
  store.setOptions("repo", { layout: "split", wordWrap: false });

  expect(decodeChangesViewOptions(storage.written())).toEqual({
    repo: {
      options: { layout: "split", ignoreWhitespace: false, wordWrap: false },
      updatedAt: 7,
    },
  });
  expect(new ChangesViewOptionsStore({ storage }).options("repo")).toEqual({
    layout: "split",
    ignoreWhitespace: false,
    wordWrap: false,
  });
});

test("reset returns a scope to the defaults", () => {
  const store = new ChangesViewOptionsStore();
  store.setOptions("repo", { layout: "split" });
  store.reset("repo");
  expect(store.options("repo")).toEqual(defaultChangesViewOptions);
  expect(store.getSnapshot()["repo"]).toBeUndefined();
});

test.each([
  null,
  "invalid",
  "null",
  "[]",
  '{"repo":{"options":{"layout":"inline","ignoreWhitespace":false,"wordWrap":true},"updatedAt":1}}',
  '{"repo":{"options":{"layout":"split"},"updatedAt":1}}',
])("invalid storage %s falls back to the defaults", (stored) => {
  expect(decodeChangesViewOptions(stored)).toEqual({});
  expect(
    new ChangesViewOptionsStore({ storage: memoryStorage(stored ?? undefined) }).options("repo"),
  ).toEqual(defaultChangesViewOptions);
});

test("scopes are capped by evicting the least recently updated", () => {
  const clock = { now: 100 };
  const store = new ChangesViewOptionsStore({ now: () => clock.now, maxScopes: 2 });
  for (const scope of ["a", "b", "c"]) {
    store.setOptions(scope, { layout: "split" });
    clock.now += 10;
  }

  expect(store.options("a")).toEqual(defaultChangesViewOptions);
  expect(store.options("b").layout).toBe("split");
  expect(store.options("c").layout).toBe("split");
  expect(Object.keys(store.getSnapshot())).toHaveLength(2);
});

test("subscribers are notified only on real changes", () => {
  const store = new ChangesViewOptionsStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  store.setOptions("repo", { layout: "split" });
  store.setOptions("repo", { layout: "split" });
  store.reset("other");
  expect(notifications).toBe(1);

  unsubscribe();
  store.setOptions("repo", { wordWrap: false });
  expect(notifications).toBe(1);
});
