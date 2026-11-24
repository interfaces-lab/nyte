import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { asId } from "@nyte-ai/schema";
import type { Message } from "@nyte-ai/schema/model";
import { afterEach, assert, describe, expect, it } from "vitest";
import { localProvider, openHost } from "../src/index.ts";
import { findExecutable } from "../src/local/process/command.ts";
import { fakeModels } from "./fixtures/fake-models.ts";
import type { FakeModels } from "./fixtures/fake-models.ts";

const hasGit = (await findExecutable("git")) !== null;

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const OUTSIDE_WORKTREE =
  "Autoresearch commits and reverts code, so it runs only in a chat with its own worktree. Start the chat in a worktree, then turn Autoresearch on.";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true, maxRetries: 10 });
  }
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "ignore" });
}

function callInit() {
  return {
    content: [
      {
        type: "toolCall" as const,
        id: "init",
        name: "init_experiment",
        arguments: { name: "Speed", metric: "seconds", unit: "s", direction: "lower" },
      },
    ],
  };
}

function say(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function toolResults(fake: FakeModels): readonly string[] {
  return (fake.requests.at(-1)?.context.messages ?? []).flatMap((message: Message) =>
    message.role === "toolResult"
      ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
      : [],
  );
}

async function sessionIds(host: Connection): Promise<readonly string[]> {
  return (await host.sessions.list()).items.map((session) => session.id);
}

describe.skipIf(!hasGit)("autoresearch", () => {
  it.each<{
    readonly name: string;
    readonly isolated: boolean;
    readonly run: (input: {
      readonly host: Connection;
      readonly fake: FakeModels;
      readonly chat: string;
    }) => Promise<void>;
  }>([
    {
      name: "the plugin has no /autoresearch command, so the composer's toggle owns the name and nothing starts",
      isolated: false,
      async run({ host, chat }) {
        expect(await host.session(asId(chat)).command("autoresearch", "make it faster")).toEqual({
          kind: "unknown",
        });
        expect(await sessionIds(host)).toEqual([chat]);
      },
    },
    {
      name: "its tools refuse in a chat without its own worktree",
      isolated: false,
      async run({ host, fake, chat }) {
        fake.reply(callInit(), say("Stopped."));
        await (await host.session(asId(chat)).send("Start.")).settled();

        expect(toolResults(fake).some((text) => text.includes(OUTSIDE_WORKTREE))).toBe(true);
      },
    },
    {
      name: "its tools run in the chat's own worktree",
      isolated: true,
      async run({ host, fake, chat }) {
        fake.reply(callInit(), say("Started."));
        await (await host.session(asId(chat)).send("Start.")).settled();

        expect(toolResults(fake).some((text) => text.startsWith('Started "Speed"'))).toBe(true);
      },
    },
  ])(
    "$name",
    async ({ isolated, run }) => {
      const home = await mkdtemp(join(tmpdir(), "nyte-autoresearch-"));
      folders.push(home);
      const repo = join(home, "repo");
      await mkdir(repo, { recursive: true });
      git(repo, "init", "-q", "-b", "main");
      git(repo, "config", "user.name", "Ada");
      git(repo, "config", "user.email", "ada@example.com");
      await writeFile(join(repo, "README.md"), "Hi.\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "first");

      const fake = fakeModels();

      await using host = await openHost({
        store: memoryStore(),
        models: fake.models,
        plugins: [{ id: "local", environment: localProvider({ home }) }],
        workspace: { kind: "local", path: repo },
        home,
      });

      const workspace = (await host.workspaces.list()).find(
        (entry) => "path" in entry.target && entry.target.path.endsWith("repo"),
      );
      assert(workspace !== undefined);
      fake.reply(say("Hi."));

      const { session, receipt } = await host.sessions.start({
        workspace: workspace.id,
        content: "Hi.",
        ...(isolated && { isolation: "worktree" as const }),
        configuration: { settings: { "mode.autoresearch": true } },
      });
      await receipt.settled();

      await run({ host, fake, chat: session.id });
    },
    60_000,
  );
});
