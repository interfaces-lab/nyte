import { asId } from "@nyte-ai/schema";
import type { WorkspaceTarget } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { memoryStore } from "../src/store.ts";
import { isPart, tool } from "../src/index.ts";
import type { EnvironmentProvider, Plugin, Store, Worktree } from "../src/index.ts";
import type { ComposeOptions } from "../src/server.ts";
import { env, until } from "../src/harness.ts";
import { composed, fakeModels } from "./fake-models.ts";
import type { FakeModels } from "./fake-models.ts";

function locate(target: WorkspaceTarget): string {
  return "locator" in target ? JSON.stringify(target.locator) : target.path;
}

function repository(options?: { readonly worktrees?: boolean }) {
  const created: string[] = [];
  const removed: Worktree[] = [];

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

              return { folder: "removed", branch: "deleted" };
            },
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

  it("runs a task's subagent in a worktree, names it in the reply, and makes no second worktree when the task replays after a restart", async () => {
    const store = memoryStore();
    const fake = fakeModels();
    const repo = repository();

    fake.reply(
      {
        content: [
          {
            type: "toolCall",
            id: "call-task",
            name: "task",
            arguments: { prompt: "Fix the login.", title: "fixer", isolation: "worktree" },
          },
        ],
      },
      { content: [{ type: "text", text: "Still fixing" }], hold: true },
    );

    const first = await host(fake, repo.plugin, { store });
    const { session: parent } = await first.sessions.start({ content: "Delegate it." });

    await until(async () => {
      const execution = (await parent.view()).execution;

      return execution.kind === "waiting" &&
        execution.on.kind === "run" &&
        fake.requests.length === 2
        ? true
        : undefined;
    });
    await first.close();

    fake.reply(
      { content: [{ type: "text", text: "Fixed it." }] },
      { content: [{ type: "text", text: "The subagent fixed it." }] },
    );

    await using second = await host(fake, repo.plugin, { store });
    const receipt = second.session(parent.id).receipt(asId<"receipt">(parent.id));

    expect(await receipt.settled()).toMatchObject({ kind: "completed" });

    const children = await second.sessions.list({
      parents: { kind: "children", session: parent.id },
    });
    const child = children.items[0];
    assert(child !== undefined);

    expect(children.items).toHaveLength(1);
    expect(repo.created).toEqual([child.id]);

    const call = (await second.session(parent.id).view()).messages.find(
      (message) => isPart(message, tool) && message.state.call.endsWith(":call-task"),
    );

    expect(call).toMatchObject({
      state: {
        phase: "settled",
        outcome: {
          kind: "ok",
          content: [
            {
              kind: "text",
              text: `It works in the worktree ${child.workspace} on branch nyte/fixer.\n\nSubagent ${child.id} finished.\n\nFixed it.`,
            },
          ],
        },
      },
    });
  });
});
