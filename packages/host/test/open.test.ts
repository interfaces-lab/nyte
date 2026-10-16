import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryStore } from "@nyte-ai/core/store";
import type { Host, Store } from "@nyte-ai/core";
import type { HostView } from "@nyte-ai/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nyteProviders } from "@nyte-ai/ai";
import { storedAccounts } from "../../ai/test/credential-fixture.ts";
import { createModels } from "@nyte-ai/ai/models";
import { credentialStore, defaultSecrets, localProvider, openHost } from "../src/index.ts";
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

  it("defaults to ai's Nyte providers and Claude Code over this host's credential store", async () => {
    const home = await folder();

    await using host = await openHost({
      store: memoryStore(),
      plugins: [chatOnly],
      workspace: { kind: "chat-only", locator: null },
      home,
    });

    expect((await host.models.list()).providers.map((provider) => provider.id)).toEqual([
      ...nyteProviders().map((provider) => provider.id),
      "claude-code",
    ]);
  });

  it("restores a credentialed provider's saved catalog at open, with no network call", async () => {
    const home = await folder();
    const store = memoryStore();
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    await mkdir(join(home, ".nyte"));
    await writeFile(
      join(home, ".nyte", "models-store.json"),
      JSON.stringify({
        rawCatalogs: {
          opencode: {
            checkedAt: Date.now(),
            models: [
              {
                id: "saved-model",
                name: "Saved model",
                api: "openai-completions",
                provider: "opencode",
                baseUrl: "https://example.test/v1",
                reasoning: false,
                input: ["text"],
                cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 100_000,
                maxTokens: 4_096,
              },
            ],
          },
        },
      }),
    );
    await credentialStore(store, defaultSecrets(home)).modify("opencode", async () =>
      storedAccounts({
        type: "api_key",
        key: "saved-key",
      }),
    );

    const options = {
      store,
      plugins: [chatOnly],
      workspace: { kind: "chat-only", locator: null },
      home,
    };

    try {
      await (await openHost(options)).close();
      await using host = await openHost(options);

      const opencode = (await host.models.list()).providers.find(
        (provider) => provider.id === "opencode",
      );

      expect(opencode?.models.map((model) => model.ref.id)).toEqual(["saved-model"]);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defaults the store to <home>/.nyte/nyte.db and the workspace to the local folder process.cwd()", async () => {
    const home = await folder();
    const first = await openHost({ models: fakeModels().models, home });
    const created = await first.sessions.create({});
    await first.close();

    expect(await readdir(join(home, ".nyte"))).toContain("nyte.db");
    await using second = await openHost({ models: fakeModels().models, home });
    const [workspace] = await second.workspaces.list();

    expect((await second.sessions.list({})).items.map((info) => info.id)).toContain(created.id);
    expect(workspace?.target).toEqual({ kind: "local", path: process.cwd() });
  });

  it("loads a local workspace's plugin files only once the folder is trusted", async () => {
    const home = await folder();
    const workspace = await folder();
    await mkdir(join(workspace, ".nyte", "plugins"), { recursive: true });
    await writeFile(
      join(workspace, ".nyte", "plugins", "mine.mjs"),
      'export default { id: "mine" };\n',
    );

    await using host = await openHost({
      store: memoryStore(),
      models: fakeModels().models,
      plugins: [{ id: "local", environment: localProvider({ home }) }],
      workspace: { kind: "local", path: workspace },
      home,
    });

    const [info] = await host.workspaces.list();
    await host.sessions.create({ workspace: info.id });

    expect(info.projectResources).toBeNull();
    expect(info.projectSources).toContain(".nyte/plugins/mine.mjs");
    expect((await viewOf(host)).plugins.map((row) => row.id)).not.toContain("mine");

    expect(await host.workspace(info.id).update({ projectResources: true })).toEqual({
      kind: "updated",
    });
    await host.sessions.create({ workspace: info.id });

    expect((await viewOf(host)).plugins.map((row) => row.id)).toContain("mine");
  });

  it("listens with an identity from <home>/.nyte/identity.key and X-Nyte-Host on every answer", async () => {
    const home = await folder();
    await using host = await open(home);

    await using listener = await host.listen({
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });

    const identity = await listener.fetch(new Request("http://host.test/.nyte/identity?nonce=n1"));
    const answer: unknown = await identity.json();

    expect(answer).toMatchObject({ hostId: host.hostId, nonce: "n1" });
    expect(await readdir(join(home, ".nyte"))).toEqual(["identity.key"]);

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

  it("reads no secrets key across open, listen, models.list() and the identity route", async () => {
    const home = await folder();
    let reads = 0;

    await using host = await openHost({
      store: memoryStore(),
      plugins: [chatOnly],
      workspace: { kind: "chat-only", locator: null },
      home,
      secrets: {
        key: async () => {
          reads += 1;

          return new Uint8Array(32);
        },
      },
    });

    await using listener = await host.listen({
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });

    expect((await host.models.list()).providers.length).toBeGreaterThan(0);
    expect(
      (await listener.fetch(new Request("http://host.test/.nyte/identity?nonce=n1"))).status,
    ).toBe(200);
    expect(reads).toBe(0);
  });

  it("with a credential stored, reads no secrets key at open, listen, models.list() or the identity route; a model request reads it once (§55)", async () => {
    const home = await folder();
    const store = memoryStore();
    let reads = 0;

    const secrets = {
      key: async () => {
        reads += 1;

        return new Uint8Array(32).fill(9);
      },
    };

    for (const provider of ["opencode", "test"])
      await credentialStore(store, secrets).modify(provider, async () =>
        storedAccounts({
          type: "api_key",
          key: "saved-key",
        }),
      );
    reads = 0;
    const workspace = { kind: "chat-only", locator: null } as const;
    const options = { store, plugins: [chatOnly], workspace, home, secrets };

    const restored = await openHost(options);

    const listener = await restored.listen({
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });

    const listed = await restored.models.list();

    expect(listed.providers.find((row) => row.id === "opencode")?.credential).toBe("configured");
    expect(
      (await listener.fetch(new Request("http://host.test/.nyte/identity?nonce=n1"))).status,
    ).toBe(200);
    await restored.close();
    expect(reads).toBe(0);

    const fake = fakeModels({
      into: createModels({ credentials: credentialStore(store, secrets) }),
    });

    await using host = await openHost({ ...options, models: fake.models });

    expect((await host.models.list()).providers[0]?.credential).toBe("configured");
    expect(reads).toBe(0);
    fake.reply({ content: [{ type: "text", text: "hi" }] });
    await (await (await host.sessions.create()).send("Hello")).settled();

    expect(fake.requests).toHaveLength(1);
    expect(reads).toBe(1);
  });

  it("reloads plugin files when one lands in the watched directory, and withdraws a failure once the file loads", async () => {
    const home = await folder();
    const dir = join(home, ".nyte", "plugins");
    await mkdir(dir, { recursive: true });
    await using host = await open(home);
    const before = await viewOf(host);

    expect(before.plugins.some((row) => row.id === "hot")).toBe(false);
    await writeFile(join(dir, "hot.mjs"), 'export default { id: "hot" };\n');

    const landed = await viewWhere(
      host,
      (view) => view.catalog !== before.catalog && view.plugins.some((row) => row.id === "hot"),
    );

    expect(landed.plugins.find((row) => row.id === "hot")).toMatchObject({
      source: "user",
      path: join(dir, "hot.mjs"),
    });
    expect(landed.plugins.some((row) => row.id === "chat-only")).toBe(true);

    const broken = join(dir, "broken.mjs");
    await writeFile(broken, "export default {;\n");
    await viewWhere(host, (view) => view.plugins.some((row) => row.id === broken));
    await writeFile(broken, 'export default { id: "mended" };\n');

    const mended = await viewWhere(
      host,
      (view) =>
        view.plugins.some((row) => row.id === "mended") &&
        !view.plugins.some((row) => row.id === broken),
    );

    expect(mended.plugins.some((row) => row.id === "hot")).toBe(true);
  });
});

async function viewWhere(host: Host, matches: (view: HostView) => boolean): Promise<HostView> {
  const views = host.watch()[Symbol.asyncIterator]();
  const deadline = setTimeout(() => void views.return?.(), 5000);

  try {
    for (let next = await views.next(); next.done !== true; next = await views.next())
      if (matches(next.value)) return next.value;
  } finally {
    clearTimeout(deadline);
    await views.return?.();
  }

  throw new Error("No host view matched within 5 s.");
}
