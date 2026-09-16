import { expect, test } from "vitest";
import { ChangesViewedStore, decodeChangesViewed, patchDigest } from "./changes-viewed.ts";
import type { ChangesViewedOptions, ViewedFile } from "./changes-viewed.ts";

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

function storeAt(clock: { now: number }, options: ChangesViewedOptions = {}) {
  return new ChangesViewedStore({ now: () => clock.now, ...options });
}

const file = (path: string, digest: string): ViewedFile => ({ path, digest });

test("a file reads as viewed only while its patch digest matches", () => {
  const store = new ChangesViewedStore();
  const original = file("src/app.ts", patchDigest("@@ -1 +1 @@\n-a\n+b\n"));
  expect(store.fileState("repo", original)).toBe("unviewed");

  store.markViewed("repo", original);
  expect(store.fileState("repo", original)).toBe("viewed");

  const edited = file("src/app.ts", patchDigest("@@ -1 +1 @@\n-a\n+c\n"));
  expect(store.fileState("repo", edited)).toBe("changed");

  store.markViewed("repo", edited);
  expect(store.fileState("repo", edited)).toBe("viewed");
});

test("marks are per repository and per path", () => {
  const store = new ChangesViewedStore();
  store.markViewed("repo-a", file("src/app.ts", "d1"));
  expect(store.fileState("repo-b", file("src/app.ts", "d1"))).toBe("unviewed");
  expect(store.fileState("repo-a", file("src/other.ts", "d1"))).toBe("unviewed");
});

test("patch digests differ for different patches and repeat for equal ones", () => {
  expect(patchDigest("-a\n+b\n")).toBe(patchDigest("-a\n+b\n"));
  expect(patchDigest("-a\n+b\n")).not.toBe(patchDigest("-a\n+c\n"));
  expect(patchDigest("ab")).not.toBe(patchDigest("ba"));
});

test("the tri-state summary reports none, some, and all", () => {
  const store = new ChangesViewedStore();
  const files = [file("a.ts", "d1"), file("b.ts", "d2"), file("c.ts", "d3")];
  expect(store.summary("repo", [])).toBe("none");
  expect(store.summary("repo", files)).toBe("none");

  store.markViewed("repo", files[0]);
  expect(store.summary("repo", files)).toBe("some");

  store.markAllViewed("repo", files);
  expect(store.summary("repo", files)).toBe("all");

  // A stale mark drops the master checkbox out of "all".
  expect(store.summary("repo", [files[0], files[1], file("c.ts", "d4")])).toBe("some");

  store.clearAllViewed("repo", ["a.ts", "b.ts"]);
  expect(store.summary("repo", files)).toBe("some");
  store.clearViewed("repo", "c.ts");
  expect(store.summary("repo", files)).toBe("none");
});

test("entries per repository are capped by evicting the oldest marks", () => {
  const clock = { now: 1_000 };
  const store = storeAt(clock, { maxFilesPerRepository: 3 });
  for (const path of ["a.ts", "b.ts", "c.ts"]) {
    store.markViewed("repo", file(path, "d"));
    clock.now += 10;
  }
  store.markViewed("repo", file("d.ts", "d"));

  expect(store.fileState("repo", file("a.ts", "d"))).toBe("unviewed");
  expect(store.fileState("repo", file("b.ts", "d"))).toBe("viewed");
  expect(store.fileState("repo", file("d.ts", "d"))).toBe("viewed");
  expect(Object.keys(store.getSnapshot()["repo"]?.files ?? {})).toHaveLength(3);
});

test("repositories untouched past the retention window are dropped on load", () => {
  const clock = { now: 10_000 };
  const storage = memoryStorage();
  const first = new ChangesViewedStore({
    storage,
    now: () => clock.now,
    repositoryRetentionMs: 1_000,
  });
  first.markViewed("stale", file("a.ts", "d1"));
  clock.now = 11_500;
  first.markViewed("fresh", file("b.ts", "d2"));

  clock.now = 11_600;
  const reloaded = new ChangesViewedStore({
    storage,
    now: () => clock.now,
    repositoryRetentionMs: 1_000,
  });
  expect(reloaded.fileState("stale", file("a.ts", "d1"))).toBe("unviewed");
  expect(reloaded.fileState("fresh", file("b.ts", "d2"))).toBe("viewed");
});

test("marks round-trip through storage", () => {
  const storage = memoryStorage();
  const store = new ChangesViewedStore({ storage, now: () => 5 });
  store.markViewed("repo", file("src/app.ts", "digest-1"));

  expect(decodeChangesViewed(storage.written())).toEqual({
    repo: { touchedAt: 5, files: { "src/app.ts": { digest: "digest-1", at: 5 } } },
  });
  const reloaded = new ChangesViewedStore({ storage, now: () => 6 });
  expect(reloaded.fileState("repo", file("src/app.ts", "digest-1"))).toBe("viewed");
  expect(reloaded.fileState("repo", file("src/app.ts", "digest-2"))).toBe("changed");
});

test.each([null, "invalid", "null", "[]", '{"repo":{"files":{}}}', '{"repo":{"touchedAt":"1"}}'])(
  "invalid storage %s reads as no marks",
  (stored) => {
    expect(decodeChangesViewed(stored)).toEqual({});
    expect(
      new ChangesViewedStore({ storage: memoryStorage(stored ?? undefined) }).fileState(
        "repo",
        file("a.ts", "d1"),
      ),
    ).toBe("unviewed");
  },
);

test("subscribers are notified only on real changes", () => {
  const store = new ChangesViewedStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  store.markViewed("repo", file("a.ts", "d1"));
  store.markViewed("repo", file("a.ts", "d1"));
  store.markAllViewed("repo", []);
  store.clearViewed("repo", "missing.ts");
  expect(notifications).toBe(1);

  const before = store.getSnapshot();
  store.markViewed("repo", file("b.ts", "d2"));
  expect(store.getSnapshot()).not.toBe(before);
  expect(notifications).toBe(2);

  unsubscribe();
  store.clearViewed("repo", "a.ts");
  expect(notifications).toBe(2);
});
