import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { BrowserHistoryStore, HISTORY_LIMIT } from "./browser-history.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function historyPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nyte-browser-history-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));

  return join(root, "browser-history.json");
}

const HOME = { kind: "home" } as const;

const PROJECT = { kind: "project", path: "/work/app" } as const;

test("a revisit moves the page to the front, counts it, and keeps its title", async () => {
  const store = new BrowserHistoryStore(await historyPath());
  await store.record(HOME, { url: "http://localhost:3000/", at: 1 });
  await store.retitle(HOME, { url: "http://localhost:3000/", title: "Dev server" });
  await store.record(HOME, { url: "https://example.com/", at: 2 });
  const entries = await store.record(HOME, { url: "http://localhost:3000/", at: 3 });

  expect(entries).toEqual([
    { url: "http://localhost:3000/", title: "Dev server", visitedAt: 3, visits: 2 },
    { url: "https://example.com/", title: "", visitedAt: 2, visits: 1 },
  ]);
});

test("each owner keeps its own newest pages up to the limit", async () => {
  const store = new BrowserHistoryStore(await historyPath());

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

test("a new store reads what the last one wrote, and clearing an owner leaves the others", async () => {
  const path = await historyPath();
  const first = new BrowserHistoryStore(path);
  await first.record(HOME, { url: "https://example.com/", at: 1 });
  await first.record(PROJECT, { url: "http://localhost:5173/", at: 2 });
  await first.record(PROJECT, { url: "http://localhost:5173/docs", at: 3 });
  await first.remove(PROJECT, "http://localhost:5173/docs");

  const second = new BrowserHistoryStore(path);

  expect((await second.entries(PROJECT)).map((entry) => entry.url)).toEqual([
    "http://localhost:5173/",
  ]);
  expect(await second.clear(PROJECT)).toEqual([]);
  expect(await second.clear(PROJECT)).toBeUndefined();

  const third = new BrowserHistoryStore(path);

  expect(await third.entries(PROJECT)).toEqual([]);
  expect((await third.entries(HOME)).map((entry) => entry.url)).toEqual(["https://example.com/"]);
});

test("a damaged file reads as no history and is replaced by the next visit", async () => {
  const path = await historyPath();
  await writeFile(path, "{ not json");
  const store = new BrowserHistoryStore(path);

  expect(await store.entries(HOME)).toEqual([]);
  await store.record(HOME, { url: "https://example.com/", at: 1 });
  expect(await new BrowserHistoryStore(path).entries(HOME)).toHaveLength(1);
});
