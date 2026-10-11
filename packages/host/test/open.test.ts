import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryStore } from "@nyte-ai/core";
import type { Host, Store } from "@nyte-ai/core";
import type { HostView } from "@nyte-ai/schema";
import { afterEach, describe, expect, it } from "vitest";
import { nyteProviders } from "@nyte-ai/ai";
import { defaultSecrets, localProvider, openHost } from "../src/index.ts";
import { chatOnly, fakeModels } from "../src/bench/fake-models.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-open-")));
  folders.push(made);

  return made;
}

const TOKEN = "a-token-of-16-chars";

/** Returns the host's current view, the first `watch()` yields. */
async function viewOf(host: Host): Promise<HostView> {
  for await (const view of host.watch()) return view;

  throw new Error("The host view ended.");
}

function open(home: string, store: Store = memoryStore()) {
  return openHost({
    store,
    models: fakeModels().models,
    plugins: [chatOnly],
    workspace: { kind: "chat-only", locator: null },
    home,
  });
}

describe("defaultSecrets", () => {
  it("mints a 0600 key file once and reads it back; a key of the wrong size is invalid", async () => {
    const home = await folder();
    const source = defaultSecrets(home);
    const first = await source.key();
    const path = join(home, ".nyte", "secret.key");

    expect(first).toHaveLength(32);
    expect(await source.key()).toBe(first);
    expect(await defaultSecrets(home).key()).toEqual(first);
    expect(new Uint8Array(await readFile(path))).toEqual(first);

    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(home, ".nyte"))).mode & 0o777).toBe(0o700);
    }

    const short = await folder();
    await mkdir(join(short, ".nyte"));
    await writeFile(join(short, ".nyte", "secret.key"), new Uint8Array(10));

    await expect(defaultSecrets(short).key()).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("defaultSecrets minting", () => {
  it("agrees on one key when fresh sources mint at once, and reads again after a rejection", async () => {
    for (let round = 0; round < 10; round += 1) {
      const home = await folder();
      const keys = await Promise.all(Array.from({ length: 8 }, () => defaultSecrets(home).key()));

      expect(keys.every((key) => key.length === 32)).toBe(true);
      expect(new Set(keys.map((key) => key.toHex())).size).toBe(1);
      expect(await readdir(join(home, ".nyte"))).toEqual(["secret.key"]);
    }

    const home = await folder();
    const path = join(home, ".nyte", "secret.key");
    await mkdir(join(home, ".nyte"));
    await writeFile(path, new Uint8Array(10));
    const source = defaultSecrets(home);

    await expect(source.key()).rejects.toMatchObject({ code: "invalid" });
    await writeFile(path, new Uint8Array(32).fill(4));
    expect(await source.key()).toEqual(new Uint8Array(32).fill(4));
  });
});

describe("openHost", () => {
  it("seeds settings.json once: a value set over the wire wins, an unknown id is reported with the path", async () => {
    const home = await folder();
    const store = memoryStore();
    await mkdir(join(home, ".nyte"));
    await writeFile(
      join(home, ".nyte", "settings.json"),
      JSON.stringify({ "skills.paths": ["/seeded"], nope: 1 }),
    );
    const paths = async (host: Host) =>
      (await viewOf(host)).settings.find((setting) => setting.id === "skills.paths")?.value;
    const first = await open(home, store);

    expect(await paths(first)).toEqual(["/seeded"]);
    expect((await viewOf(first)).plugins.find((row) => row.id === "settings")).toEqual({
      id: "settings",
      source: "user",
      path: join(home, ".nyte", "settings.json"),
      issues: [expect.objectContaining({ severity: "warning", path: ["nope"] })],
    });
    expect(await first.settings.apply("skills.paths", ["/wire"])).toEqual({ kind: "applied" });
    await first.close();

    await using second = await open(home, store);

    expect(await paths(second)).toEqual(["/wire"]);
  });

  it("reports a settings file that is not a JSON object, and opens", async () => {
    const home = await folder();
    await mkdir(join(home, ".nyte"));
    await writeFile(join(home, ".nyte", "settings.json"), "[1, 2]");
    await using host = await open(home);

    expect((await viewOf(host)).plugins.find((row) => row.id === "settings")).toMatchObject({
      path: join(home, ".nyte", "settings.json"),
      issues: [expect.objectContaining({ severity: "warning" })],
    });
  });

  it("loads plugin files by scope and reports a bad or reserved one without failing the open", async () => {
    const home = await folder();
    const dir = join(home, ".nyte", "plugins");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "good.mjs"), 'export default { id: "good" };\n');
    await writeFile(join(dir, "broken.mjs"), "export default {;\n");
    await writeFile(join(dir, "reserved.mjs"), 'export default { id: "models" };\n');
    await using host = await open(home);
    const rows = (await viewOf(host)).plugins;

    expect(rows.find((row) => row.id === "good")).toMatchObject({
      source: "user",
      path: join(dir, "good.mjs"),
    });
    expect(rows.find((row) => row.id === join(dir, "broken.mjs"))).toMatchObject({
      source: "user",
      issues: [expect.objectContaining({ severity: "error" })],
    });
    expect(rows.find((row) => row.id === join(dir, "reserved.mjs"))).toMatchObject({
      source: "user",
      issues: [expect.objectContaining({ path: ["id"] })],
    });
  });

  it("defaults to ai's Nyte providers over this host's credential store", async () => {
    const home = await folder();

    await using host = await openHost({
      store: memoryStore(),
      plugins: [chatOnly],
      workspace: { kind: "chat-only", locator: null },
      home,
    });

    expect((await host.models.list()).providers.map((provider) => provider.id)).toEqual(
      nyteProviders().map((provider) => provider.id),
    );
  });

  it("loads a local workspace's plugin files as project plugins", async () => {
    const home = await folder();
    const workspace = await folder();
    await mkdir(join(workspace, ".nyte", "plugins"), { recursive: true });
    await writeFile(join(workspace, ".nyte", "plugins", "mine.mjs"), 'export default { id: "mine" };\n');

    await using host = await openHost({
      store: memoryStore(),
      models: fakeModels().models,
      plugins: [{ id: "local", environment: localProvider({ home }) }],
      workspace: { kind: "local", path: workspace },
      home,
    });

    expect((await viewOf(host)).plugins.find((row) => row.id === "mine")).toMatchObject({
      source: "project",
      path: join(workspace, ".nyte", "plugins", "mine.mjs"),
    });
  });

  it("listens with an identity the secrets key derives and X-Nyte-Host on every answer", async () => {
    const home = await folder();
    await using host = await open(home);
    await using listener = await host.listen({
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });
    const identity = await listener.fetch(new Request("http://host.test/.nyte/identity?nonce=n1"));
    const answer: unknown = await identity.json();

    expect(answer).toMatchObject({ hostId: host.hostId, nonce: "n1" });

    if (
      typeof answer !== "object" ||
      answer === null ||
      !("publicKey" in answer) ||
      !("signature" in answer) ||
      typeof answer.publicKey !== "string" ||
      typeof answer.signature !== "string"
    )
      throw new Error("The identity answer has no key and signature.");

    const publicKey = await crypto.subtle.importKey(
      "raw",
      Uint8Array.fromBase64(answer.publicKey, { alphabet: "base64url" }),
      "Ed25519",
      false,
      ["verify"],
    );

    expect(
      await crypto.subtle.verify(
        "Ed25519",
        publicKey,
        Uint8Array.fromBase64(answer.signature, { alphabet: "base64url" }),
        new TextEncoder().encode(`nyte/identity\n${host.hostId}\nn1`),
      ),
    ).toBe(true);

    const described = await listener.fetch(new Request("http://host.test/.nyte/describe"));
    const refused = await listener.fetch(
      new Request("http://host.test/sessions.list", { method: "POST", body: "{}" }),
    );

    expect(await described.json()).toMatchObject({ platform: process.platform });
    expect(described.headers.get("X-Nyte-Host")).toBe(host.hostId);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("X-Nyte-Host")).toBe(host.hostId);
  });
});
