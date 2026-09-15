import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/ai";
import type { NyteOptions } from "@nyte-ai/core";
import { createHost } from "@nyte-ai/host";
import { createOtelExport } from "@nyte-ai/host/otel";
import { DesktopHost } from "./host.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";
import { ipcDiagnostics, ipcFailure } from "./errors.ts";
import { callIpc } from "./ipc-call.ts";

const directories: string[] = [];
const hosts: DesktopHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  ipcDiagnostics.clear();
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const model: Model<Api> = {
  id: "summary-fixture",
  name: "Summary fixture",
  api: "openai-responses",
  provider: "fixture",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 100,
};

async function fixture(active: boolean) {
  const root = await mkdtemp(join(tmpdir(), "nyte-summary-diagnostics-"));
  directories.push(root);
  vi.stubEnv("NYTE_HOME", root);
  const original = new TypeError("synthetic-private-provider-body");
  const diagnostics: Parameters<NonNullable<NyteOptions["onDiagnostic"]>>[0][] = [];
  const stream = () => {
    throw original;
  };
  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createModels: () => {
      const models = createModels({
        credentials: new InMemoryCredentialStore(),
        modelsStore: new InMemoryModelsStore(),
      });
      models.setProvider({
        id: model.provider,
        name: model.name,
        auth: {
          apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) },
        },
        getModels: () => [model],
        stream,
        streamSimple: stream,
      });
      return models;
    },
    createHost: (options) =>
      createHost({
        ...options,
        plugins: active
          ? { kind: "custom", plugins: [], env: { cwd: root } }
          : {
              kind: "workspace",
              target: { kind: "deferred", resolve: async () => ({ kind: "inactive" }) },
            },
        onDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
          return options.onDiagnostic?.(diagnostic);
        },
      }),
    createOtelExport: () => createOtelExport({ serviceName: "fixture", endpoint: "" }),
    emitHostEvent: () => undefined,
    emitWatchEvent: () => undefined,
    openExternal: () => assert.fail("External browser is unused"),
    revealPath: () => undefined,
    showContextMenu: () => Promise.resolve(undefined),
    pickFolder: async () => undefined,
    listFonts: async () => ({ sans: [], monospace: [] }),
    browser: {
      menu: async () => undefined,
      perform: async () => undefined,
      open: () => assert.fail("Browser is unused"),
      navigate: () => undefined,
      close: () => undefined,
      captureFrame: () => Promise.resolve(undefined),
      setBounds: () => undefined,
      retain: () => undefined,
      release: () => undefined,
      warm: async () => undefined,
      dispose: () => undefined,
      agent: unusedBrowserAgent(),
    },
  });
  hosts.push(host);
  const info = await host.call("sessions.create", undefined);
  const open = await host.prepare();
  const session = await open.store.open(info.sessionId);
  try {
    const from = await session.refs.read("refs/heads/main");
    const [tip] = await session.objects.put([
      {
        kind: "commit",
        parent: from,
        at: 1_000,
        body: {
          kind: "message",
          message: { role: "user", content: "Summarize me", timestamp: 1_000 },
        },
      },
    ]);
    assert.ok(tip);
    assert.equal(
      (
        await session.refs.update([{ name: "refs/heads/main", from, to: tip }], {
          reason: "fixture",
        })
      ).ok,
      true,
    );
    return { host, sessionId: info.sessionId, original, diagnostics, tip };
  } finally {
    await session.close();
  }
}

test("desktop retains the SDK summary cause under its public ID and shares IPC eviction", async () => {
  const { host, sessionId, original, diagnostics, tip } = await fixture(true);
  const ipcIds = Array.from({ length: 32 }, () => {
    const failure = ipcFailure(new Error("synthetic-ipc-body"));
    assert.ok(failure.correlationId);
    return failure.correlationId;
  });
  const result = await callIpc(() => host, {
    path: "heads.move",
    input: { sessionId, to: null, summary: {} },
  });
  assert.equal(result.ok, true);
  assert.equal(result.path, "heads.move");
  assert.equal(diagnostics.length, 1);
  const diagnostic = diagnostics[0];
  assert.ok(diagnostic);
  assert.deepEqual(result.value, {
    kind: "failed",
    code: "internal",
    message: "Internal error",
    correlationId: diagnostic.correlationId,
  });
  assert.equal(diagnostic.operation, "heads.move");
  assert.equal(ipcDiagnostics.get(diagnostic.correlationId), diagnostic.cause);
  assert.ok(diagnostic.cause instanceof Error);
  // The catalog turns provider throws into error events before core builds this cause.
  assert.ok(diagnostic.cause.message.includes(original.message));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-|cause|TypeError/);
  assert.deepEqual([...ipcDiagnostics.keys()], [...ipcIds.slice(1), diagnostic.correlationId]);
  const open = await host.prepare();
  const session = await open.store.open(sessionId);
  try {
    assert.equal(await session.refs.read("refs/heads/main"), tip);
  } finally {
    await session.close();
  }
  const newerIds = Array.from({ length: 32 }, () => {
    const failure = ipcFailure(new Error("later IPC failure"));
    assert.ok(failure.correlationId);
    return failure.correlationId;
  });
  assert.deepEqual([...ipcDiagnostics.keys()], newerIds);
  assert.equal(ipcDiagnostics.has(diagnostic.correlationId), false);
});

test("inactive summary and missing-head refusal add no desktop diagnostics", async () => {
  const { host, sessionId, diagnostics } = await fixture(false);
  const retained = ipcFailure(new Error("existing diagnostic"));
  const before = [...ipcDiagnostics];
  assert.deepEqual(await host.call("heads.move", { sessionId, to: null, summary: {} }), {
    kind: "failed",
    code: "inactive",
    message: "Session is not active in this host",
  });
  assert.deepEqual(await host.call("heads.move", { sessionId, head: "missing", to: null }), {
    kind: "not_found",
  });
  assert.ok(retained.correlationId);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual([...ipcDiagnostics], before);
});
