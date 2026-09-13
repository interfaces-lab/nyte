import assert from "node:assert/strict";
import { afterAll, test, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { NyteBridge } from "../../shared/ipc.ts";
import { mentionFilesOptions } from "./queries.ts";

const bridge = vi.hoisted(() => {
  const list = vi.fn<NyteBridge["host"]["files"]["list"]>();
  const cancelList = vi.fn<NyteBridge["host"]["files"]["cancelList"]>();
  vi.stubGlobal("window", { nyte: { host: { files: { list, cancelList } } } });
  return { list, cancelList };
});
afterAll(() => vi.unstubAllGlobals());

test("unmounting the last mention consumer cancels its running host request", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const cancelled = Promise.withResolvers<string>();
  const pending = Promise.withResolvers<readonly []>();
  bridge.list.mockImplementation(() => pending.promise);
  bridge.cancelList.mockImplementation(async ({ requestId }) => {
    cancelled.resolve(requestId);
    pending.reject(new Error("aborted"));
  });
  const observer = new QueryObserver(client, mentionFilesOptions(true));
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    const request = bridge.list.mock.calls.at(-1)?.[0];
    assert.ok(request);
    unsubscribe();
    assert.equal(await cancelled.promise, request.requestId);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("discovery failure produces an error query, not an empty ready list", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const failure = new Error("ripgrep installation failed");
  bridge.list.mockRejectedValue(failure);
  try {
    const options = mentionFilesOptions(true);
    await assert.rejects(client.fetchQuery(options), (error) => error === failure);
    assert.equal(client.getQueryState(options.queryKey)?.status, "error");
    assert.equal(client.getQueryData(options.queryKey), undefined);
  } finally {
    client.clear();
  }
});
