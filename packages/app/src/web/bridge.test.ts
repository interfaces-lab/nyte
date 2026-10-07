import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProfile } from "@nyte-ai/host/runtime";
import type { HostProfile } from "@nyte-ai/host/runtime";
import { sessionId } from "@nyte-ai/protocol";
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

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

/**
 * A registry host with a real profile key: `/v1/info` names it and
 * `/v1/identity` signs the nonce asked. Calls are kept as they arrived;
 * `answers` gives an operation's value, every other call answers `[]`.
 */
async function serveRegistry(answers: Readonly<Record<string, unknown>> = {}): Promise<{
  readonly profile: HostProfile;
  readonly calls: { operation: string; body: unknown }[];
}> {
  const calls: { operation: string; body: unknown }[] = [];
  const root = await mkdtemp(join(tmpdir(), "nyte-web-bridge-"));
  const profile = await openProfile("default", root);
  cleanups.push(async () => {
    await profile.release();
    await rm(root, { recursive: true, force: true });
  });
  const info = {
    version: "0.0.0",
    wireVersion: 1,
    environment: true,
    identity: { hostId: profile.hostId, publicKey: profile.publicKey },
    workspaces: { kind: "registry" },
    host: { kind: "unspecified" },
  } satisfies ServerInfo;
  vi.stubGlobal("fetch", async (resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof resource === "string"
        ? resource
        : resource instanceof URL
          ? resource.href
          : resource.url,
    );

    if (url.pathname === "/v1/identity") {
      const nonce = url.searchParams.get("nonce") ?? "";

      return Response.json({ ok: true, defined: true, value: profile.sign(nonce) });
    }

    if (url.pathname === "/v1/info") return Response.json({ ok: true, defined: true, value: info });
    const operation = url.pathname.replace("/v1/call/", "");
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ operation, body });

    return Response.json({ ok: true, defined: true, value: answers[operation] ?? [] });
  });
  vi.stubGlobal("sessionStorage", memoryStorage());

  return { profile, calls };
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test("a registry host turns on folder selection and durable starts, and a pinned identity must be proven", async () => {
  vi.useRealTimers();
  const { profile } = await serveRegistry();
  const web = createWebBridge();
  assert.equal(web.bridge.host.starts, undefined);
  assert.equal(web.bridge.host.pickWorkspace, undefined);

  const info = await web.connect({ url: "https://host.test", token: "t" }, { principal: "bearer" });
  assert.equal(info.identity?.hostId, profile.hostId);
  assert.notEqual(web.bridge.host.starts, undefined);
  assert.notEqual(web.bridge.host.pickWorkspace, undefined);
  assert.notEqual(web.bridge.host.trustWorkspace, undefined);
  assert.deepEqual((await web.bridge.host.state()).binding, {
    hostId: profile.hostId,
    principal: "bearer",
  });

  // The same host proves the identity it was pinned with; another key is a different host.
  await web.connect(
    { url: "https://host.test", token: "t" },
    { identity: { hostId: profile.hostId, publicKey: profile.publicKey }, principal: "bearer" },
  );
  const other = await openProfile("other", await mkdtemp(join(tmpdir(), "nyte-web-other-")));
  cleanups.push(() => other.release());
  await assert.rejects(
    web.connect(
      { url: "https://host.test", token: "t" },
      { identity: { hostId: other.hostId, publicKey: other.publicKey } },
    ),
    { name: "IdentityChanged" },
  );
});

test("on a registry host, workspace file and Git calls act in this browser's selected folder", async () => {
  vi.useRealTimers();
  const row = {
    id: "folder-1",
    path: "/srv/project",
    name: "project",
    registeredAt: 1,
    identity: "dev:1:ino:2",
    trust: { kind: "policy" },
  };
  const { calls } = await serveRegistry({
    "environment.workspaces.register": { kind: "registered", workspace: row },
  });
  const web = createWebBridge();
  await web.connect({ url: "https://host.test", token: "t" }, { principal: "bearer" });
  const { workspace } = web.bridge;
  const targets = (): unknown[] =>
    calls.flatMap(({ operation, body }) =>
      operation.startsWith("workspace.") &&
      typeof body === "object" &&
      body !== null &&
      "input" in body &&
      typeof body.input === "object" &&
      body.input !== null &&
      "target" in body.input
        ? [body.input.target]
        : [],
    );

  // No folder chosen: refused here, before the host hears of it.
  await assert.rejects(workspace.files({ target: { kind: "workspace" } }), /Choose a folder/u);
  assert.deepEqual(targets(), []);

  await web.bridge.host.openWorkspace({ path: row.path });
  const settled = (pending: Promise<unknown>) => pending.catch(() => undefined);
  await settled(workspace.files({ target: { kind: "workspace" } }));
  await settled(workspace.read({ target: { kind: "workspace" }, path: "README.md" }));
  await settled(workspace.blame({ target: { kind: "workspace" }, path: "README.md" }));
  await settled(workspace.vcs.snapshot({ target: { kind: "workspace" } }));
  await settled(workspace.vcs.refs({ target: { kind: "workspace" } }));
  await settled(workspace.files({ target: { kind: "session", sessionId: sessionId("s-1") } }));

  const selected = { kind: "registered", id: row.id };
  assert.deepEqual(targets(), [
    selected,
    selected,
    selected,
    selected,
    selected,
    { kind: "session", sessionId: "s-1" },
  ]);
});
