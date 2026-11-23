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
