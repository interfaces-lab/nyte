import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { asId } from "@nyte-ai/schema";
import { recordFirstFrame, seedFirstFrame } from "./first-frame.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const stored = new Map<string, string>();

vi.stubGlobal(
  "window",
  Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  }),
);

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
    home: null,
    sessions: [sessionRow("recent")],
    folder: null,
  });
}

afterEach(() => {
  stored.clear();
  queryClient.clear();
});

test("the last run's snapshot of this host seeds a new window's placeholders", () => {
  stored.set(KEY, snapshot("local"));
  seedFirstFrame("local", undefined);

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
    seedFirstFrame("local", undefined);

    assert.equal(queryClient.getQueryData(keys.modelCatalog("initial")), undefined);
    assert.equal(stored.has(KEY), false);
  });
}

test("a connection to another host than the one recorded drops the seed", async () => {
  stored.set(KEY, snapshot("local"));
  seedFirstFrame("local", undefined);
  recordFirstFrame("local", asId<"host">("host-2"));
  await Promise.resolve();

  assert.equal(stored.has(KEY), false);
  assert.equal(queryClient.getQueryData(keys.modelCatalog("initial")), undefined);
  assert.equal(queryClient.getQueryData(keys.firstFrameRoots), undefined);
  assert.equal(queryClient.getQueryData(keys.firstFrameWorkspaces), undefined);
});

test("a window Finder opened starts on its folder, as its own choice, with or without a snapshot", () => {
  const workspace = { id: asId<"workspace">("w1"), path: "/finder", name: "finder" };

  for (const snapshotted of [false, true]) {
    if (snapshotted) stored.set(KEY, snapshot("local"));
    seedFirstFrame("local", workspace);

    assert.deepEqual(queryClient.getQueryData(keys.host), { workspace });
    assert.notEqual(queryClient.getQueryState(keys.host)?.dataUpdatedAt, 0);
  }
});
