import { expect, test } from "vitest";
import { ChangesViewedStore, patchDigest } from "./changes-viewed.ts";
import type { ViewedFile } from "./changes-viewed.ts";

function memoryStorage(initial?: string): Pick<Storage, "getItem" | "setItem"> {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

const file = (path: string, digest: string): ViewedFile => ({ path, digest });

test("a file reads as viewed only while its patch digest matches", () => {
  const store = new ChangesViewedStore();
  const original = file("src/app.ts", patchDigest("@@ -1 +1 @@\n-a\n+b\n"));
  store.markViewed("repo", original);

  expect(store.fileState("repo", original)).toBe("viewed");
  expect(store.fileState("repo", file("src/app.ts", patchDigest("@@ -1 +1 @@\n-a\n+c\n")))).toBe(
    "changed",
  );
});

test("marks are isolated by repository and path", () => {
  const store = new ChangesViewedStore();
  store.markViewed("repo-a", file("src/app.ts", "d1"));

  expect(store.fileState("repo-b", file("src/app.ts", "d1"))).toBe("unviewed");
  expect(store.fileState("repo-a", file("src/other.ts", "d1"))).toBe("unviewed");
});

test("marks survive a store reload", () => {
  const storage = memoryStorage();
  const first = new ChangesViewedStore({ storage });
  first.markViewed("repo", file("src/app.ts", "digest-1"));

  const reloaded = new ChangesViewedStore({ storage });
  expect(reloaded.fileState("repo", file("src/app.ts", "digest-1"))).toBe("viewed");
});

test.each(["invalid", '{"repo":{"files":{}}}'])(
  "corrupt storage %s reads as no marks",
  (stored) => {
    const store = new ChangesViewedStore({ storage: memoryStorage(stored) });
    expect(store.fileState("repo", file("a.ts", "d1"))).toBe("unviewed");
  },
);
