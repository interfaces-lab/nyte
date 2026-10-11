import { asId } from "@nyte-ai/schema";
import type { WorkspaceId, WorkspaceTarget } from "@nyte-ai/schema";
import { composeHost, memoryStore } from "@nyte-ai/core";
import type { GitApi, Plugin } from "@nyte-ai/core";
import { afterEach, assert, describe, expect, it } from "vitest";
import { chatOnlyProvider, sandboxProvider } from "../src/providers.ts";
import type { SandboxHandle } from "../src/providers.ts";
import { fakeModels } from "../src/bench/fake-models.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Returns a sandbox handle whose files are the chat-only provider's, with the given git seam and a count of its destroys. */
async function handle(git?: GitApi): Promise<SandboxHandle & { readonly destroys: number[] }> {
  const { files } = await chatOnlyProvider().attach({ kind: "chat-only", locator: null });
  const destroys: number[] = [];

  return {
    identity: asId("sandbox-1"),
    cwd: "/vercel/sandbox",
    files,
    exec: async () => {
      throw new Error("No processes in this fake.");
    },
    git,
    destroys,
    async destroy() {
      destroys.push(Date.now());
    },
  };
}

/** Composes a host over one provider plugin and the target it serves; returns it with its workspace id. */
async function hostOver(
  plugin: Plugin<"core">,
  target: WorkspaceTarget,
): Promise<{
  readonly host: Awaited<ReturnType<typeof composeHost>>;
  readonly workspace: WorkspaceId;
}> {
  const host = await composeHost({
    store: memoryStore(),
    models: fakeModels().models,
    plugins: [plugin],
    workspace: target,
    execution: { kind: "admit-only" },
    home: null,
    operations: [],
    description: { name: "test", platform: "test", version: "0" },
  });

  cleanups.push(() => host.close());
  const workspace = host.kernel.defaultWorkspace;
  assert(workspace !== null);

  return { host, workspace };
}

describe("chatOnlyProvider", () => {
  it("answers every target available as chat-only, with files that see nothing and refuse changes, and no processes", async () => {
    const provider = chatOnlyProvider();
    const target: WorkspaceTarget = { kind: "chat-only", locator: null };

    expect(provider.kind).toBe("chat-only");
    expect(await provider.inspect(target)).toEqual({
      identity: "chat-only",
      availability: { kind: "available" },
      projectSources: [],
    });
    expect(Object.keys(provider).sort()).toEqual(["attach", "inspect", "kind"]);

    const env = await provider.attach(target);
    const { files } = env;

    expect([env.identity, env.cwd]).toEqual(["chat-only", "/"]);
    expect(await files.read("README.md")).toEqual({ kind: "missing", path: "README.md" });
    expect(await files.stat("README.md")).toBeNull();
    expect(await files.find({ query: "readme" })).toEqual([]);
    expect(await files.format("a.ts", "x")).toEqual({ kind: "unavailable", reason: "unsupported" });
    await expect(files.bytes("README.md")).rejects.toMatchObject({ code: "unknown" });

    for (const refused of [
      files.write("a.txt", "x"),
      files.remove("a.txt"),
      files.upload((async function* () {})()),
      files.batch().put({ path: "a.txt", contents: "x" }).apply(),
      env.exec("ls"),
    ])
      await expect(refused).rejects.toMatchObject({ code: "unavailable" });

    const scanned = [];

    for await (const frame of files.scan()) scanned.push(frame);

    const searched = [];

    for await (const frame of files.search({ query: "x" })) searched.push(frame);

    expect([scanned, searched]).toEqual([[{ kind: "complete" }], [{ kind: "complete" }]]);

    const watch = files.watch()[Symbol.asyncIterator]();
    const pending = watch.next();
    await watch.return?.();

    expect(await pending).toEqual({ done: true, value: undefined });
    await env.close();
  });

  it("serves a composed host's workspace with git unsupported", async () => {
    const { host, workspace } = await hostOver(
      { id: "chat-only", environment: chatOnlyProvider() },
      { kind: "chat-only", locator: null },
    );

    expect(await host.workspace(workspace).git()).toMatchObject({ kind: "unsupported" });
  });
});

describe("sandboxProvider", () => {
  it("boots a target's sandbox once, identifies it by content hash, and destroys it", async () => {
    const booted: WorkspaceTarget[] = [];
    const sandbox = await handle();

    const provider = sandboxProvider({
      boot: async (target) => {
        booted.push(target);

        return sandbox;
      },
    });

    const target: WorkspaceTarget = { kind: "sandbox", locator: { name: "a" } };

    expect(provider.kind).toBe("sandbox");
    expect((await provider.inspect(target)).identity).toMatch(/^[0-9a-f]{64}$/);
    expect(await provider.inspect(target)).toEqual(
      await provider.inspect({ kind: "sandbox", locator: { name: "a" } }),
    );
    expect(booted).toEqual([]);

    const first = await provider.attach(target);
    const second = await provider.attach(target);

    expect(booted).toHaveLength(1);
    expect([first.identity, first.cwd, second.identity]).toEqual([
      "sandbox-1",
      "/vercel/sandbox",
      "sandbox-1",
    ]);

    await provider.destroy?.(target);

    expect(sandbox.destroys).toHaveLength(1);

    await provider.attach(target);

    expect(booted).toHaveLength(2);
  });

  it("forgets a failed boot so the next attach boots again", async () => {
    let attempts = 0;

    const provider = sandboxProvider({
      kind: "vm",
      boot: async () => {
        attempts += 1;

        if (attempts === 1) throw new Error("The sandbox service is down.");

        return handle();
      },
    });

    const target: WorkspaceTarget = { kind: "vm", locator: null };

    await expect(provider.attach(target)).rejects.toThrow("down");
    expect((await provider.attach(target)).identity).toBe("sandbox-1");
    expect(attempts).toBe(2);
  });

  it("serves the handle's git seam when it has one and answers unsupported when it has none (§42c, §42o)", async () => {
    const refuse = async (): Promise<never> => {
      throw new Error("Not in this fake.");
    };

    const none = () => (async function* () {})();

    const git: GitApi = {
      status: refuse,
      watch: none,
      changes: refuse,
      watchChanges: none,
      patches: none,
      contents: refuse,
      log: refuse,
      refs: refuse,
      blame: refuse,
      stage: refuse,
      unstage: refuse,
      discard: refuse,
      commit: refuse,
      branch: refuse,
      push: refuse,
    };

    const withGit = await hostOver(
      { id: "sandbox", environment: sandboxProvider({ boot: async () => handle(git) }) },
      { kind: "sandbox", locator: { name: "with-git" } },
    );

    const withoutGit = await hostOver(
      { id: "sandbox", environment: sandboxProvider({ boot: async () => handle() }) },
      { kind: "sandbox", locator: { name: "without-git" } },
    );

    expect(await withGit.host.workspace(withGit.workspace).git()).toMatchObject({
      kind: "available",
    });
    expect(await withoutGit.host.workspace(withoutGit.workspace).git()).toMatchObject({
      kind: "unsupported",
    });
  });
});
