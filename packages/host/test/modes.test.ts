import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryStore } from "@nyte-ai/core/store";
import { asId } from "@nyte-ai/schema";
import type { Message } from "@nyte-ai/schema/model";
import { afterEach, assert, expect, it } from "vitest";
import { localProvider, openHost } from "../src/index.ts";
import { fakeModels } from "./fixtures/fake-models.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function told(messages: readonly Message[]): readonly string[] {
  return messages.flatMap((message) =>
    message.role === "user" &&
    typeof message.content === "string" &&
    message.content.startsWith("<system-reminder>")
      ? [message.content.split("\n")[1] ?? ""]
      : [],
  );
}

function offered(messages: readonly Message[]): readonly string[] {
  return messages.reduce<readonly string[]>(
    (names, message) =>
      message.role === "system"
        ? [
            ...names.filter((name) => !message.toolsRemoved?.some((tool) => tool.name === name)),
            ...(message.toolsAdded ?? []).map((tool) => tool.name),
          ]
        : names,
    [],
  );
}

it.each([
  { id: "mode.debug", title: "Debug", tools: [] },
  {
    id: "mode.autoresearch",
    title: "Autoresearch",
    tools: ["init_experiment", "run_experiment", "log_experiment"],
  },
])(
  "the built-in $title mode is a composer mode whose instructions and tools come only while it is on",
  async ({ id, title, tools }) => {
    const home = await mkdtemp(join(tmpdir(), "nyte-modes-"));
    folders.push(home);
    const fake = fakeModels();

    await using host = await openHost({
      store: memoryStore(),
      models: fake.models,
      plugins: [{ id: "local", environment: localProvider({ home }) }],
      workspace: { kind: "local", path: home },
      home,
    });

    const workspace = (await host.workspaces.list())[0];
    assert(workspace !== undefined);
    fake.reply(
      { content: [{ type: "text", text: "On." }] },
      { content: [{ type: "text", text: "Off." }] },
    );

    const { session, receipt } = await host.sessions.start({
      workspace: workspace.id,
      name: title,
      content: "Go.",
      configuration: { settings: { [id]: true } },
    });
    await receipt.settled();

    expect(
      (await session.view()).catalog.settings.find((setting) => setting.id === id),
    ).toMatchObject({
      title,
      owner: "modes",
      mode: { icon: expect.any(String) },
    });

    await session.head(asId("main")).configure({ settings: { [id]: false } });
    await (await session.send("Again.")).settled();

    const [on, off] = fake.requests.map((request) => request.context);
    assert(on !== undefined && off !== undefined);

    expect(told(on.messages)).toEqual([`${title} mode is on.`]);
    expect(told(off.messages)).toEqual([
      `${title} mode is on.`,
      `${title} mode is off. Its instructions no longer apply.`,
    ]);
    expect(tools.filter((tool) => offered(on.messages).includes(tool))).toEqual(tools);
    expect(tools.filter((tool) => offered(off.messages).includes(tool))).toEqual([]);
  },
  60_000,
);

it.each<{
  readonly name: string;
  readonly start: Readonly<Record<string, boolean>>;
  readonly commands: readonly (readonly [string, string])[];
  readonly on: readonly string[];
  readonly sent: readonly string[];
}>([
  {
    name: "/debug turns Debug on",
    start: {},
    commands: [["debug", ""]],
    on: ["mode.debug"],
    sent: [],
  },
  {
    name: "/debug while Debug is on turns it off",
    start: { "mode.debug": true },
    commands: [["debug", ""]],
    on: [],
    sent: [],
  },
  {
    name: "/debug with text turns it on and sends the text",
    start: {},
    commands: [["debug", "The login fails."]],
    on: ["mode.debug"],
    sent: ["The login fails."],
  },
  {
    name: "/debug turns the other mode off",
    start: { "mode.autoresearch": true },
    commands: [["debug", ""]],
    on: ["mode.debug"],
    sent: [],
  },
  {
    name: "/autoresearch with no text turns Autoresearch off",
    start: { "mode.autoresearch": true },
    commands: [["autoresearch", ""]],
    on: [],
    sent: [],
  },
])("slash toggles: $name", async ({ start, commands, on, sent }) => {
  const home = await mkdtemp(join(tmpdir(), "nyte-modes-"));
  folders.push(home);
  const fake = fakeModels();

  await using host = await openHost({
    store: memoryStore(),
    models: fake.models,
    plugins: [{ id: "local", environment: localProvider({ home }) }],
    workspace: { kind: "local", path: home },
    home,
  });

  const workspace = (await host.workspaces.list())[0];
  assert(workspace !== undefined);
  fake.reply(...[0, ...sent].map(() => ({ content: [{ type: "text" as const, text: "Ok." }] })));

  const { session, receipt } = await host.sessions.start({
    workspace: workspace.id,
    name: "Modes",
    content: "Go.",
    configuration: { settings: start },
  });
  await receipt.settled();

  for (const [command, text] of commands) {
    const outcome = await session.command(command, text);

    if (outcome.kind === "sent") await session.receipt(outcome.receipt).settled();
  }

  const settings = (await session.view()).configuration.effective?.settings ?? {};

  expect(["mode.debug", "mode.autoresearch"].filter((id) => settings[id] === true)).toEqual(on);
  expect(
    fake.requests
      .slice(1)
      .flatMap((request) => request.context.messages)
      .flatMap((message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        !message.content.startsWith("<system-reminder>") &&
        message.content !== "Go."
          ? [message.content]
          : [],
      ),
  ).toEqual(sent);
});
