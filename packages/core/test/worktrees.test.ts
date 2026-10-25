import { asId } from "@nyte-ai/schema";
import type { WorkspaceTarget } from "@nyte-ai/schema";
import { assert, describe, expect, it, vi } from "vitest";
import { memoryStore } from "../src/store.ts";
import type { EnvironmentProvider, Plugin, Store, Worktree } from "../src/index.ts";
import type { ComposeOptions } from "../src/server.ts";
import { env, until } from "../src/harness.ts";
import { composed, fakeModels } from "./fake-models.ts";
import type { FakeModels } from "./fake-models.ts";

function locate(target: WorkspaceTarget): string {
  return "locator" in target ? JSON.stringify(target.locator) : target.path;
}

function repository(options?: {
  readonly worktrees?: boolean;
  readonly folders?: readonly ("removed" | "kept")[];
}) {
  const created: string[] = [];
  const removed: Worktree[] = [];
  const folders = [...(options?.folders ?? [])];

  const provider: EnvironmentProvider = {
    kind: "repo",
    inspect: async (target) => ({
      identity: asId(`repo:${locate(target)}`),
      availability: { kind: "available" },
      projectSources: [],
    }),
    attach: async (target) => ({ ...env, identity: asId(`repo:${locate(target)}`) }),
    worktrees:
      options?.worktrees === false
        ? undefined
        : {
            async create(_env, input) {
              created.push(input.name);

              return {
                target: { kind: "repo", locator: `worktree:${input.name}` },
                branch: `nyte/${input.title ?? input.name}`,
                base: "c0ffee",
              };
            },
            async remove(worktree) {
              removed.push(worktree);

              return { folder: folders.shift() ?? "removed", branch: "deleted" };
            },
            clean: async () => false,
          },
  };

  const plugin: Plugin<"core"> = { id: "repo", environment: provider };

  return { plugin, created, removed };
}

function host(
  fake: FakeModels,
  plugin: Plugin<"core">,
  options?: { readonly store?: Store; readonly execution?: ComposeOptions["execution"] },
) {
  return composed({
    store: options?.store ?? memoryStore(),
    models: fake.models,
    plugins: [plugin],
    workspace: { kind: "repo", locator: "main" },
    execution: options?.execution,
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });
}

describe("worktree isolation", () => {
  it("starts a chat in a worktree of its workspace, answers the same chat on a replayed start, and removes the worktree with the chat", async () => {
    const fake = fakeModels();
    const repo = repository();
    fake.reply({ content: [{ type: "text", text: "Done." }] });
    await using served = await host(fake, repo.plugin);
    const source = (await served.workspaces.list())[0];
    assert(source !== undefined);

    const input = {
      id: asId<"session">("isolated"),
      name: "fix-login",
      isolation: "worktree",
      content: "Fix the login.",
    } as const;

    const { session, receipt } = await served.sessions.start(input);
    await receipt.settled();
    const replayed = await served.sessions.start(input);

    expect(replayed.session.id).toBe(session.id);
    expect(repo.created).toEqual(["isolated"]);

    const info = await session.info();

    expect(info.workspace).not.toBe(source.id);
    expect(await served.workspace(info.workspace).info()).toMatchObject({
      target: { kind: "repo", locator: "worktree:isolated" },
      isolation: {
        kind: "worktree",
        source: source.id,
        session: "isolated",
        branch: "nyte/fix-login",
        base: "c0ffee",
      },
    });
    expect(source.isolation).toBeNull();

    expect(await session.remove()).toEqual({ kind: "removed" });
    expect(repo.removed).toEqual([
      {
        target: { kind: "repo", locator: "worktree:isolated" },
        branch: "nyte/fix-login",
        base: "c0ffee",
      },
    ]);
    expect((await served.workspaces.list()).map((workspace) => workspace.id)).toEqual([source.id]);
  });

  it("releases a worktree its chat moves off, keeps a folder with changes listed, and sweeps it at a later open", async () => {
    const fake = fakeModels();
    const repo = repository({ folders: ["kept"] });
    const store = memoryStore();
    fake.reply({ content: [{ type: "text", text: "Done." }] });

    {
      await using served = await host(fake, repo.plugin, { store });
      const source = (await served.workspaces.list())[0];
      assert(source !== undefined);

      const { session, receipt } = await served.sessions.start({
        id: asId<"session">("moved"),
        isolation: "worktree",
        content: "Fix it.",
      });

      await receipt.settled();
      expect(await session.update({ workspace: source.id })).toEqual({ kind: "updated" });
      expect(repo.removed).toHaveLength(1);
      expect(await served.workspaces.list()).toHaveLength(2);
    }

    const later = Date.now() + 120_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => later);

    try {
      await using reopened = await host(fakeModels(), repo.plugin, { store });

      expect(
        await until(async () =>
          (await reopened.workspaces.list()).length === 1 ? repo.removed.length : undefined,
        ),
      ).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("refuses isolation in a workspace whose provider has no worktrees, starting no chat", async () => {
    const fake = fakeModels();
    await using served = await host(fake, repository({ worktrees: false }).plugin);

    await expect(
      served.sessions.start({
        id: asId("refused"),
        isolation: "worktree",
        content: "Fix the login.",
      }),
    ).rejects.toThrow("A repo workspace has no git worktrees, so this chat cannot run in one.");
    expect((await served.sessions.list()).items).toEqual([]);
  });
});
