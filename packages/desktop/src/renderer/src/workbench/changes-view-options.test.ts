import { expect, test } from "vitest";
import { ChangesViewOptionsStore } from "./changes-view-options.ts";

function memoryStorage(initial?: string): Pick<Storage, "getItem" | "setItem"> {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

test("options are kept per scope", () => {
  const store = new ChangesViewOptionsStore();
  const untouched = store.options("repo-b");
  store.setOptions("repo-a", { layout: "split", ignoreWhitespace: true });

  expect(store.options("repo-a")).toMatchObject({ layout: "split", ignoreWhitespace: true });
  expect(store.options("repo-b")).toEqual(untouched);
});

test("options survive a store reload", () => {
  const storage = memoryStorage();
  const first = new ChangesViewOptionsStore({ storage });
  first.setOptions("repo", { layout: "split", wordWrap: false });

  const reloaded = new ChangesViewOptionsStore({ storage });
  expect(reloaded.options("repo")).toMatchObject({ layout: "split", wordWrap: false });
});

test.each(["invalid", '{"repo":{"options":{"layout":"split"},"updatedAt":1}}'])(
  "corrupt storage %s falls back to the defaults",
  (stored) => {
    const fallback = new ChangesViewOptionsStore().options("repo");
    const store = new ChangesViewOptionsStore({ storage: memoryStorage(stored) });

    expect(store.options("repo")).toEqual(fallback);
  },
);
