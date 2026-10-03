import assert from "node:assert/strict";
import type { ServerInfo } from "@nyte-ai/protocol";
import { afterEach, beforeEach, test, vi } from "vitest";
import { createWebBridge } from "./bridge.ts";

/** A server whose `GET /v1/info` says whether an environment answers. */
function serve(environment: boolean): void {
  const described = {
    version: "0.0.0",
    wireVersion: 1,
    host: { kind: "unspecified" },
  } satisfies ServerInfo;
  const info = environment ? { ...described, environment: true } : described;
  vi.stubGlobal("fetch", async () => Response.json({ ok: true, defined: true, value: info }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { visibilityState: "hidden", addEventListener: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("a browser has no folder picker, trust grant, file reveal, or native menu", () => {
  const { host } = createWebBridge().bridge;

  assert.equal(host.pickWorkspace, undefined);
  assert.equal(host.trustWorkspace, undefined);
  assert.equal(host.revealPath, undefined);
  assert.equal(host.contextMenu, undefined);
  assert.equal(host.terminal, undefined);
  assert.equal(host.browser, undefined);
});

test("GitHub is present only once the connected server reports an environment", async () => {
  const web = createWebBridge();
  assert.equal(web.bridge.host.github, undefined);

  serve(false);
  await web.connect({ url: "https://server.test", token: "t" });
  assert.equal(web.bridge.environment, undefined);
  assert.equal(web.bridge.host.github, undefined);

  serve(true);
  await web.connect({ url: "https://server.test", token: "t" });
  assert.equal(web.bridge.environment, true);
  assert.notEqual(web.bridge.host.github, undefined);
});
