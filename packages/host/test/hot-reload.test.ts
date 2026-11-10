import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryStore } from "@nyte-ai/core/store";
import type { Host, Session } from "@nyte-ai/core";
import type { HostView } from "@nyte-ai/schema";
import { getSystemMessageText } from "@nyte-ai/schema/model";
import type { Message } from "@nyte-ai/schema/model";
import { afterEach, assert, describe, expect, it } from "vitest";
import { localProvider, openHost } from "../src/index.ts";
import { fakeModels } from "./fixtures/fake-models.ts";
import type { FakeModels } from "./fixtures/fake-models.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-hot-")));
  folders.push(made);

  return made;
}

function plugin(id: string, command: string, log?: string): string {
  const activate =
    log === undefined
      ? ""
      : `activate: async () => { const { appendFile } = await import("node:fs/promises"); await appendFile(${JSON.stringify(log)}, "activated\\n"); },`;

  return `export default { id: ${JSON.stringify(id)}, ${activate} contribute: { commands: [{ name: ${JSON.stringify(command)}, title: "T", description: "D", run: () => "ran" }] } };\n`;
}

async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  wait = 5_000,
): Promise<T> {
  const deadline = Date.now() + wait;

  for (;;) {
    const value = await read();

    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function commands(session: Session): Promise<readonly string[]> {
  return ((await session.view())?.catalog.commands ?? []).map((command) => command.name);
}

async function addPlugin(
  session: Session,
  file: string,
  id: string,
  command: string,
): Promise<readonly string[]> {
  for (let attempt = 0; ; attempt += 1) {
    await writeFile(file, `${plugin(id, command)}// ${attempt}\n`);

    const names = await eventually(
      () => commands(session),
      (found) => found.includes(command),
      2_000,
    );

    if (names.includes(command) || attempt === 2) return names;
  }
}

async function pluginRows(host: Host): Promise<HostView["plugins"]> {
  for await (const view of host.watch()) return view.plugins;

  return [];
}

async function chatIn(home: string, workspace: string, fake: FakeModels = fakeModels()) {
  const host = await openHost({
    store: memoryStore(),
    models: fake.models,
    plugins: [{ id: "local", environment: localProvider({ home }) }],
    workspace: { kind: "local", path: workspace },
    home,
  });

  const [info] = await host.workspaces.list();
  assert(info !== undefined);
  await host.workspace(info.id).update({ projectResources: true });
  const { session, receipt } = await host.sessions.start({ workspace: info.id, content: "Hi." });
  await receipt.settled();

  return { host, session };
}

describe("hot reload", () => {
  it("follows a trusted folder's .nyte/plugins in an open chat: an edit, a new plugin folder, and a broken file beside good ones", async () => {
    const home = await folder();
    const workspace = await folder();
    const dir = join(workspace, ".nyte", "plugins");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "mine.mjs"), plugin("mine", "first-name"));
    await writeFile(join(dir, "broken.mjs"), "export default {;\n");
    const opened = await chatIn(home, workspace);
    await using host = opened.host;

    expect(await commands(opened.session)).toContain("first-name");

    await writeFile(join(dir, "mine.mjs"), plugin("mine", "second-name"));
    expect(
      await eventually(
        () => commands(opened.session),
        (names) => names.includes("second-name"),
      ),
    ).toContain("second-name");

    await mkdir(join(dir, "added"));
    await writeFile(join(dir, "added", "index.mjs"), plugin("added", "added-name"));
    expect(
      await eventually(
        () => commands(opened.session),
        (names) => names.includes("added-name"),
      ),
    ).toEqual(expect.arrayContaining(["second-name", "added-name"]));

    const row = (await pluginRows(host)).find((candidate) => candidate.id === dir);
    expect(row?.issues).toEqual([
      expect.objectContaining({ severity: "error", path: [join(dir, "broken.mjs")] }),
    ]);
  });

  it("follows skills and plugins under a .nyte/ the folder's .gitignore ignores", async () => {
    const home = await folder();
    const workspace = await folder();
    await writeFile(join(workspace, ".gitignore"), ".nyte/\n");
    await mkdir(join(workspace, ".nyte", "plugins"), { recursive: true });
    await mkdir(join(workspace, ".nyte", "skills", "one"), { recursive: true });
    await writeFile(join(workspace, ".nyte", "skills", "one", "SKILL.md"), "---\nname: one\n---\n");
    const opened = await chatIn(home, workspace);
    await using _host = opened.host;

    const skills = async () =>
      ((await opened.session.view())?.catalog.skills ?? []).map((skill) => skill.name);

    await mkdir(join(workspace, ".nyte", "skills", "two"));
    await writeFile(join(workspace, ".nyte", "skills", "two", "SKILL.md"), "---\nname: two\n---\n");
    await writeFile(
      join(workspace, ".nyte", "plugins", "mine.mjs"),
      plugin("mine", "ignored-name"),
    );

    expect(await eventually(skills, (names) => names.includes("two"))).toEqual(
      expect.arrayContaining(["one", "two"]),
    );
    expect(
      await eventually(
        () => commands(opened.session),
        (names) => names.includes("ignored-name"),
      ),
    ).toContain("ignored-name");
  });

  it("leaves a chat's plugins running when a file under .nyte/plugins changes but no plugin does", async () => {
    const home = await folder();
    const workspace = await folder();
    const dir = join(workspace, ".nyte", "plugins");
    const log = join(workspace, "activations.log");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "mine.mjs"), plugin("mine", "steady", log));
    const opened = await chatIn(home, workspace);
    await using _host = opened.host;
    const before = await readFile(log, "utf8");

    await writeFile(join(dir, "README.md"), "Notes.\n");
    expect(
      await addPlugin(opened.session, join(dir, "fresh.mjs"), "fresh", "fresh-name"),
    ).toContain("fresh-name");
    const reloaded = await readFile(log, "utf8");
    await writeFile(join(dir, "README.md"), "More notes.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(before.split("\n").filter(Boolean)).toHaveLength(1);
    expect(reloaded.split("\n").filter(Boolean)).toHaveLength(2);
    expect(await readFile(log, "utf8")).toBe(reloaded);
  });

  it("keeps an open chat's history as sent and sends an edited AGENTS.md as a system prompt update after it", async () => {
    const home = await folder();
    const workspace = await folder();
    await writeFile(join(workspace, "AGENTS.md"), "Rule one.\n");
    const fake = fakeModels({ compat: { supportsMidConvoSystemMessages: true } });
    const opened = await chatIn(home, workspace, fake);
    await using _host = opened.host;
    const chat = (): readonly Message[][] =>
      fake.requests
        .map((request) => request.context.messages)
        .filter(
          (messages) => messages[0]?.role === "system" && sent(messages[0]).includes("<0000-"),
        );

    await writeFile(join(workspace, "AGENTS.md"), "Rule two.\n");
    await (await opened.session.send("Again.")).settled();
    await (await opened.session.send("Third.")).settled();
    const [first, second, third] = chat();
    assert(first !== undefined && second !== undefined && third !== undefined);

    expect(sent(first[0])).toContain("Rule one.");
    expect(shape(second.slice(0, first.length))).toEqual(shape(first));
    expect(shape(third.slice(0, second.length))).toEqual(shape(second));

    const update = second.at(-1);
    assert(update?.role === "system");
    expect(update.sections?.["project-context"]).toContain("Rule two.");
    expect(third.filter((message) => message.role === "system")).toHaveLength(2);
  });
});

function sent(message: Message | undefined): string {
  if (message === undefined) return "";

  if (message.role === "system") return getSystemMessageText(message);

  return JSON.stringify(message.content);
}

function shape(messages: readonly Message[]): readonly string[] {
  return messages.map((message) => `${message.role}:${sent(message)}`);
}
