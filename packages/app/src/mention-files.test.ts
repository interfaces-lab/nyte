import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { NyteBridge } from "./bridge.ts";
import { mentionFilesOptions } from "./queries.ts";

const files = vi.hoisted(() => vi.fn<NyteBridge["workspace"]["files"]>());
vi.mock("./nyte.ts", () => ({ nyte: { workspace: { files } } }));

test("mention discovery publishes the workspace files", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const readme = {
    path: "/workspace/README.md",
    url: "file:///workspace/README.md",
    displayPath: "README.md",
    label: "README.md",
  };
  files.mockReset();
  files.mockResolvedValue([readme]);
  try {
    assert.deepEqual(await client.fetchQuery(mentionFilesOptions(true)), [readme]);
  } finally {
    client.clear();
  }
});

test("discovery failure produces an error query, not an empty ready list", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const failure = new Error("ripgrep installation failed");
  files.mockReset();
  files.mockRejectedValue(failure);
  try {
    const options = mentionFilesOptions(true);
    await assert.rejects(client.fetchQuery(options), (error) => error === failure);
    assert.equal(client.getQueryState(options.queryKey)?.status, "error");
    assert.equal(client.getQueryData(options.queryKey), undefined);
  } finally {
    client.clear();
  }
});
