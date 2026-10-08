import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { BrowserHistoryEntry } from "@nyte-ai/app/bridge.ts";
import { BrowserHistoryStore, HISTORY_LIMIT, TITLE_LIMIT, URL_LIMIT } from "./browser-history.ts";
import { ipcDiagnostics } from "./errors.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.useRealTimers();
  ipcDiagnostics.clear();

  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function historyPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nyte-browser-history-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));

  return join(root, "browser-history.json");
}

/** A store whose writes are counted and fail while `failing` is set. */
async function openStore(delay?: number) {
  const path = await historyPath();
  const disk = { writes: 0, failing: false };

  const store = new BrowserHistoryStore(path, {
    delay,
    write: async (target, contents) => {
      if (disk.failing) throw new Error("disk full");
      disk.writes += 1;
      await writeFile(target, contents);
    },
  });

  cleanups.push(() => store.flush());

  const saved = async (owner: typeof HOME | typeof PROJECT) =>
    (await new BrowserHistoryStore(path).entries(owner)).map((entry) => entry.url);

  return { store, disk, saved };
}

const HOME = { kind: "home" } as const;

const PROJECT = { kind: "project", path: "/work/app" } as const;

test("a revisit moves the page to the front, counts it, and keeps its title", async () => {
  const { store } = await openStore();
  await store.record(HOME, { url: "http://localhost:3000/", at: 1 });
  await store.retitle(HOME, { url: "http://localhost:3000/", title: "Dev server" });
  await store.record(HOME, { url: "https://example.com/", at: 2 });
  await store.record(HOME, { url: "http://localhost:3000/", at: 3 });

  expect(await store.entries(HOME)).toEqual([
    { url: "http://localhost:3000/", title: "Dev server", visitedAt: 3, visits: 2 },
    { url: "https://example.com/", title: "", visitedAt: 2, visits: 1 },
  ]);
});

test("each owner keeps its own newest pages up to the limit", async () => {
  const { store } = await openStore();

  for (let index = 0; index <= HISTORY_LIMIT; index += 1) {
    await store.record(HOME, { url: `https://example.com/${String(index)}`, at: index });
  }

  await store.record(PROJECT, { url: "http://localhost:5173/", at: 1 });
  const home = await store.entries(HOME);

  expect(home).toHaveLength(HISTORY_LIMIT);
  expect(home[0]?.url).toBe(`https://example.com/${String(HISTORY_LIMIT)}`);
  expect(home.at(-1)?.url).toBe("https://example.com/1");
  expect((await store.entries(PROJECT)).map((entry) => entry.url)).toEqual([
    "http://localhost:5173/",
  ]);
});

test("a removal or clear lands at once with the visits still waiting, and leaves other owners", async () => {
  const { store, disk, saved } = await openStore(60_000);
  const heard: [string | null, readonly BrowserHistoryEntry[]][] = [];
  store.listen((owner, entries) => heard.push([owner, entries]));
  await store.record(HOME, { url: "https://example.com/", at: 1 });
  await store.record(PROJECT, { url: "http://localhost:5173/", at: 2 });
  await store.record(PROJECT, { url: "http://localhost:5173/docs", at: 3 });
  expect(disk.writes).toBe(0);

  await store.remove(PROJECT, "http://localhost:5173/docs");
  expect(disk.writes).toBe(1);
  expect(await saved(PROJECT)).toEqual(["http://localhost:5173/"]);

  heard.length = 0;
  await store.clear(PROJECT);
  await store.clear(PROJECT);

  expect(disk.writes).toBe(2);
  expect(heard).toEqual([["/work/app", []]]);
  expect(await saved(PROJECT)).toEqual([]);
  expect(await saved(HOME)).toEqual(["https://example.com/"]);
});

test("a damaged file reads as no history and is replaced by the next write", async () => {
  const path = await historyPath();
  await writeFile(path, "{ not json");
  const store = new BrowserHistoryStore(path);

  expect(await store.entries(HOME)).toEqual([]);
  await store.record(HOME, { url: "https://example.com/", at: 1 });
  await store.flush();
  expect(await new BrowserHistoryStore(path).entries(HOME)).toHaveLength(1);
});

test("visits in one window become one write and one event per owner", async () => {
  vi.useFakeTimers();
  const { store, disk, saved } = await openStore();
  const heard: (string | null)[] = [];
  store.listen((owner) => heard.push(owner));

  for (let index = 0; index < 50; index += 1) {
    await store.record(HOME, { url: `https://example.com/${String(index)}`, at: index });
    await store.retitle(HOME, { url: `https://example.com/${String(index)}`, title: "Page" });
  }

  expect(disk.writes).toBe(0);
  expect(heard).toEqual([]);

  await vi.advanceTimersByTimeAsync(2000);

  expect(disk.writes).toBe(1);
  expect(heard).toEqual([null]);
  await store.flush();
  expect((await saved(HOME))[0]).toBe("https://example.com/49");
});

test("a failed write rejects a clear, keeps the history, and the next write saves it all", async () => {
  const { store, disk, saved } = await openStore(60_000);
  const heard: (string | null)[] = [];
  await store.record(HOME, { url: "https://example.com/", at: 1 });
  store.listen((owner) => heard.push(owner));
  disk.failing = true;

  await expect(store.clear(HOME)).rejects.toThrow("disk full");
  await expect(store.remove(HOME, "https://example.com/")).rejects.toThrow("disk full");
  expect(await store.entries(HOME)).toHaveLength(1);
  expect(heard).toEqual([]);

  await store.record(HOME, { url: "https://example.org/", at: 2 });
  await store.flush();
  expect(ipcDiagnostics.get("browser-history")).toBeInstanceOf(Error);
  expect(disk.writes).toBe(0);

  disk.failing = false;
  await store.flush();
  expect(await saved(HOME)).toEqual(["https://example.org/", "https://example.com/"]);

  await store.clear(HOME);
  expect(await store.entries(HOME)).toEqual([]);
  expect(await saved(HOME)).toEqual([]);
});

test("titles are cut to a limit and overlong addresses are not remembered", async () => {
  const { store } = await openStore();
  await store.record(HOME, { url: "https://example.com/", at: 1 });
  await store.retitle(HOME, { url: "https://example.com/", title: "x".repeat(TITLE_LIMIT + 50) });
  await store.record(HOME, { url: `https://example.com/${"a".repeat(URL_LIMIT)}`, at: 2 });

  const entries = await store.entries(HOME);

  expect(entries.map((entry) => entry.url)).toEqual(["https://example.com/"]);
  expect(entries[0]?.title).toHaveLength(TITLE_LIMIT);
});
