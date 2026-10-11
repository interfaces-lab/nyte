import { isPart, tool } from "@nyte-ai/core";
import type { ToolDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, expect, it } from "vitest";
import codemode from "../src/codemode.ts";
import { fakeModels, open } from "./fake-models.ts";

const text = standard(Type.Object({ text: Type.String() }));

const echo: ToolDefinition<{ text: string }> = {
  name: "echo",
  description: "Echo the text.",
  parameters: text,
  class: () => ({ kind: "custom", label: "Echoing" }),
  replay: "safe",
  execute: async (args) => ({ content: [{ kind: "text", text: `echo: ${args.text}` }] }),
};

const shout: ToolDefinition<{ text: string }, { loud: string }> = {
  name: "shout",
  description: "Upper-case the text; callable from code only.",
  parameters: text,
  output: standard(Type.Object({ loud: Type.String() })),
  exposure: "code",
  class: () => ({ kind: "custom", label: "Shouting" }),
  replay: "safe",
  execute: async (args) => ({ content: [], output: { loud: args.text.toUpperCase() } }),
};

const lookup: ToolDefinition<{ text: string }> = {
  ...echo,
  name: "lookup",
  namespace: "mcp/docs",
  description: "Echo the text from the docs server.",
};

it("searches tools within a namespace", async () => {
  const fake = fakeModels();
  const script = 'const all = await searchTools("echo text"); const docs = await searchTools("echo text", { namespace: "mcp/docs" }); return JSON.stringify([["echo", "lookup"].every((name) => all.some((tool) => tool.name === name)), docs]);';

  fake.reply(
    { content: [{ type: "toolCall", id: "find", name: "codemode", arguments: { code: script } }] },
    { content: [{ type: "text", text: "Found." }] },
  );

  await using host = await open(fake, [codemode, { id: "tools", contribute: { tools: [echo, lookup] } }]);
  const session = await host.sessions.create();
  await (await session.send("Find tools.")).settled();

  const call = (await session.view()).messages.find((message) => isPart(message, tool) && message.state.name === "codemode");

  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled" && call.state.outcome.kind === "ok");
  expect(call.state.outcome.content).toEqual([
    {
      kind: "text",
      text: JSON.stringify([true, [{ name: "lookup", namespace: "mcp/docs", description: lookup.description }]]),
    },
  ]);
});

it("runs a script that calls two tools, one exposed to code only, and keeps its store", async () => {
  const fake = fakeModels();
  const script = 'const a = await tools.echo({ text: "hi" }); const b = await tools.shout({ text: a }); store("last", b.loud); return `${a} | ${b.loud}`;';

  fake.reply(
    { content: [{ type: "toolCall", id: "code", name: "codemode", arguments: { code: script } }] },
    { content: [{ type: "toolCall", id: "again", name: "codemode", arguments: { code: 'return load("last");' } }] },
    { content: [{ type: "text", text: "Done." }] },
  );

  await using host = await open(fake, [codemode, { id: "tools", contribute: { tools: [echo, shout] } }]);
  const session = await host.sessions.create();
  await (await session.send("Script it.")).settled();

  const outcomes = (await session.view()).messages.flatMap((message) =>
    isPart(message, tool) && message.state.name === "codemode" && message.state.phase === "settled" ? [message.state.outcome] : [],
  );

  expect(outcomes).toMatchObject([
    { kind: "ok", content: [{ kind: "text", text: "echo: hi | ECHO: HI" }] },
    { kind: "ok", content: [{ kind: "text", text: "ECHO: HI" }] },
  ]);

  const [system] = fake.requests[0]?.context.messages ?? [];

  assert(system?.role === "system");
  expect(system.toolsAdded?.map((declared) => declared.name)).not.toContain("shout");
});
