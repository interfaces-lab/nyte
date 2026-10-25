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
  namespace: { name: "mcp__docs", aliases: ["docs"], instructions: "Ask the docs server." },
  description: "Echo the text from the docs server.",
};

it("searches tools within a namespace and describes the namespace", async () => {
  const fake = fakeModels();
  const script =
    'const all = await searchTools("echo text"); const docs = await searchTools("echo text", { namespace: "docs" }); return JSON.stringify([all.map((tool) => tool.name), docs, await describeNamespace("mcp__docs")]);';

  fake.reply(
    { content: [{ type: "toolCall", id: "find", name: "codemode", arguments: { code: script } }] },
    { content: [{ type: "text", text: "Found." }] },
  );

  await using host = await open(fake, [
    codemode,
    { id: "tools", contribute: { tools: [echo, lookup] } },
  ]);
  const { session, receipt: started } = await host.sessions.start({
    content: "Find tools.",
  });
  await started.settled();

  const call = (await session.view()).messages.find(
    (message) => isPart(message, tool) && message.state.name === "codemode",
  );

  assert(
    call !== undefined &&
      isPart(call, tool) &&
      call.state.phase === "settled" &&
      call.state.outcome.kind === "ok",
  );
  const [output] = call.state.outcome.content;

  assert(output?.kind === "text");
  expect(JSON.parse(output.text)).toEqual([
    expect.arrayContaining(["echo", "lookup"]),
    [{ name: "lookup", description: expect.stringContaining(lookup.description) }],
    { name: "mcp__docs", instructions: "Ask the docs server.", tools: ["lookup"] },
  ]);
});

it("runs a script that calls two tools, one exposed to code only, and keeps its store", async () => {
  const fake = fakeModels();
  const script =
    'const a = await tools.echo({ text: "hi" }); const b = await tools.shout({ text: a }); store("last", b.loud); return `${a} | ${b.loud}`;';

  fake.reply(
    { content: [{ type: "toolCall", id: "code", name: "codemode", arguments: { code: script } }] },
    {
      content: [
        {
          type: "toolCall",
          id: "again",
          name: "codemode",
          arguments: { code: 'return load("last");' },
        },
      ],
    },
    { content: [{ type: "text", text: "Done." }] },
  );

  await using host = await open(fake, [
    codemode,
    { id: "tools", contribute: { tools: [echo, shout] } },
  ]);
  const { session, receipt: started } = await host.sessions.start({
    content: "Script it.",
  });
  await started.settled();

  const outcomes = (await session.view()).messages.flatMap((message) =>
    isPart(message, tool) && message.state.name === "codemode" && message.state.phase === "settled"
      ? [message.state.outcome]
      : [],
  );

  expect(outcomes).toMatchObject([
    { kind: "ok", content: [{ kind: "text", text: "echo: hi | ECHO: HI" }] },
    { kind: "ok", content: [{ kind: "text", text: "ECHO: HI" }] },
  ]);

  const [system] = fake.requests[0]?.context.messages ?? [];

  assert(system?.role === "system");
  expect(system.toolsAdded?.map((declared) => declared.name)).not.toContain("shout");
  expect(system.content).toContain(
    "<0096-codemode>\nTools you reach only from a codemode script, as `await tools.<name>(args)`:\n\n### `shout`\n",
  );
  expect(system.content).toContain("Upper-case the text; callable from code only.");
});
