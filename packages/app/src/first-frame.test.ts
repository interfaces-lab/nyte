import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { asId } from "@nyte-ai/schema";
import { recordFirstFrame, seedFirstFrame } from "./first-frame.ts";
import { keys, queryClient } from "./queries.ts";
import { sessionRow } from "../test/view-fixtures.ts";

const stored = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
});

vi.stubGlobal("window", new EventTarget());

vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));

const KEY = "nyte.first-frame.v1";

const catalog = {
  generation: asId<"catalog-generation">("g1"),
  default: { provider: "e2e", id: "scripted" },
  providers: [],
};

function snapshot(host: string): string {
  return JSON.stringify({
    host,
    hostId: "host-1",
    catalog,
    workspaces: [],
    sessions: [sessionRow("recent")],
  });
}

afterEach(() => {
  stored.clear();
  queryClient.clear();
});

test("the last run's snapshot of this host seeds a new window's placeholders", () => {
  stored.set(KEY, snapshot("local"));
  seedFirstFrame("local");

  assert.deepEqual(queryClient.getQueryData(keys.modelCatalog("initial")), catalog);
  assert.equal(queryClient.getQueryState(keys.modelCatalog("initial"))?.dataUpdatedAt, 0);
  assert.deepEqual(queryClient.getQueryData(keys.firstFrameWorkspaces), []);
  assert.equal(queryClient.getQueryData(keys.workspaces), undefined);
  assert.deepEqual(queryClient.getQueryData(keys.firstFrameRoots), [sessionRow("recent")]);
});

for (const [name, value] of [
  ["another host's", snapshot("https://elsewhere.example")],
  ["an unreadable", "{"],
  ["an older shape of", JSON.stringify({ host: "local", catalog })],
] as const) {
  test(`${name} snapshot seeds nothing and is forgotten`, () => {
    stored.set(KEY, value);
    seedFirstFrame("local");

    assert.equal(queryClient.getQueryData(keys.modelCatalog("initial")), undefined);
    assert.equal(stored.has(KEY), false);
  });
}

test("a connection to another host than the one recorded drops the seed", async () => {
  stored.set(KEY, snapshot("local"));
  seedFirstFrame("local");
  recordFirstFrame("local", asId<"host">("host-2"));
  await Promise.resolve();

  assert.equal(stored.has(KEY), false);
  assert.equal(queryClient.getQueryData(keys.modelCatalog("initial")), undefined);
  assert.equal(queryClient.getQueryData(keys.firstFrameRoots), undefined);
  assert.equal(queryClient.getQueryData(keys.firstFrameWorkspaces), undefined);
});
