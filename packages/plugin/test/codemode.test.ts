import { getCurrentTools } from "@nyte-ai/schema";
import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { afterEach, test } from "vitest";
import { definePlugin, inlinePlugin, ToolError } from "@nyte-ai/core/plugins";
import type { StreamFn } from "@nyte-ai/core";
import { Type } from "typebox";
import { codemodePlugin } from "../src/codemode.ts";
import { executeCodemode } from "../src/codemode-execute.ts";
import { TestWorkspace, prompt, respond, testModel, toolCall, toolResultOf } from "./host.ts";

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const world of workspaces.splice(0)) await world.close();
});

const fixturePlugin = definePlugin({
  id: "codemode-fixtures",
  session(api) {
    api.tools.add((draft) => {
      draft.set("fixture_direct", {
        name: "fixture_direct",
        description: "Read a local fixture",
        parameters: Type.Object({}),
        exposure: "direct",
        execute: async () => ({
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
          details: {},
        }),
      });
      draft.set("fixture_catalog", {
        name: "fixture_catalog",
        description: "Raw registry catalog fixture",
        parameters: Type.Object({ private_catalog_field: Type.String() }),
        exposure: "codemode",
        execute: async () => ({ content: [], details: {} }),
      });
      draft.set("mcp__fixture__echo", {
        name: "mcp__fixture__echo",
        description: "Repeat a fixture message",
        namespace: {
          name: "mcp__fixture",
          description: "Local fixture tools",
          instructions: "Use quartz fixture operations",
        },
        parameters: Type.Object({ message: Type.String() }),
        outputSchema: Type.Object({
          content: Type.Array(Type.Object({ type: Type.String(), text: Type.String() })),
          isError: Type.Optional(Type.Boolean()),
          _meta: Type.Optional(Type.Object({})),
          structuredContent: Type.Optional(Type.Object({ message: Type.String() })),
        }),
        exposure: "codemode",
        execute: async (_id, { message }) => {
          throw new ToolError({
            content: [{ type: "text", text: "not the structured result" }],
            details: {},
            structuredContent: { content: [], structuredContent: { message }, isError: true },
          });
        },
      });
      draft.set("mcp__fixture__lookup", {
        name: "mcp__fixture__lookup",
        description: "Look up fixture issues",
        namespace: { name: "mcp__fixture" },
        parameters: Type.Object({}),
        exposure: "deferred",
        execute: async () => ({ content: [{ type: "text", text: "issue 42" }], details: {} }),
      });
      draft.set("fixture_blocked", {
        name: "fixture_blocked",
        description: "A policy blocks this fixture",
        parameters: Type.Object({}),
        exposure: "direct",
        execute: async () => {
          throw new Error("must not execute");
        },
      });
      draft.set("fixture_hidden", {
        name: "fixture_hidden",
        description: "Do not discover this fixture",
        parameters: Type.Object({}),
        exposure: "hidden",
        execute: async () => {
          throw new Error("must not execute");
        },
      });
    });
    api.hook("before_tool", (event) =>
      event.toolName === "fixture_blocked"
        ? { action: "reject", message: "fixture policy denied" }
        : { action: "continue" },
    );
  },
});

async function open(streamFn: StreamFn) {
  const world = TestWorkspace.create("nyte-codemode-");
  workspaces.push(world);
  const sdk = await world.open({
    streamFn,
    plugins: [inlinePlugin(fixturePlugin), inlinePlugin(codemodePlugin())],
    model: testModel,
  });
  return { world, sdk };
}

test("QuickJS discovers the live inventory, calls direct and MCP tools, and emits images and returned values", async () => {
  let sent = false;
  const { world, sdk } = await open((model, context) => {
    if (sent) return respond(model, [{ type: "text", text: "done" }]);
    sent = true;
    const description =
      getCurrentTools(context.messages).find((tool) => tool.name === "codemode")?.description ?? "";
    assert.doesNotMatch(
      description,
      /Repeat a fixture message|fixture_catalog|private_catalog_field/,
    );
    return respond(model, [
      toolCall("script", "codemode", {
        code: `
      text(await tools.fixture_direct({}));
      const matches = await searchTools("repeat message", { namespace: "fixture" });
      text(matches.map(tool => tool.name));
      text(await describeTool(matches[0].name));
      text(await describeNamespace("fixture"));
      text({ instructionsSearch: (await searchTools("quartz", { namespace: "fixture" })).map(tool => tool.name) });
      text(ALL_TOOLS.some(tool => tool.name === "fixture_hidden"));
      text("codemode" in tools);
      text("tool_search" in tools);
      image("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=");
      return await tools.mcp__fixture__echo({ message: "structured" });
    `,
      }),
    ]);
  });
  await prompt(sdk, world.sessionId, "run");
  const result = await toolResultOf({ sdk, sessionId: world.sessionId, callId: "script" });
  assert.equal(result.isError, false, JSON.stringify(result));
  const text = result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  assert.match(text, /first\nsecond/);
  assert.match(text, /Promise<CallToolResult/);
  assert.match(text, /"tools":\["mcp__fixture__echo","mcp__fixture__lookup"\]/);
  assert.match(text, /"instructions":"Use quartz fixture operations"/);
  assert.match(text, /"instructionsSearch":\["mcp__fixture__echo"\]/);
  assert.match(text, /false\nfalse\nfalse/);
  assert.match(text, /"structuredContent":\{"message":"structured"\},"isError":true/);
  assert.ok(result.content.some((block) => block.type === "image"));
});

test("failed scripts retain partial output and nested calls pass through policy", async () => {
  let sent = false;
  const { world, sdk } = await open((model) => {
    if (sent) return respond(model, [{ type: "text", text: "done" }]);
    sent = true;
    return respond(model, [
      toolCall("failure", "codemode", { code: 'text("before"); await tools.fixture_blocked({});' }),
    ]);
  });
  await prompt(sdk, world.sessionId, "run");
  const result = await toolResultOf({ sdk, sessionId: world.sessionId, callId: "failure" });
  assert.equal(result.isError, true);
  const text = result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  assert.match(text, /Script failed/);
  assert.match(text, /before/);
  assert.match(text, /fixture policy denied/);
  assert.match(text, /fixture_blocked \(error\)/);
  assert.doesNotMatch(text, /must not execute/);
});

test("successful writes survive later calls while failed writes do not, and discovery loads tools only once", async () => {
  let step = 0;
  const declarations: string[][] = [];
  const { world, sdk } = await open((model, context) => {
    declarations.push(getCurrentTools(context.messages).map((tool) => tool.name));
    const calls = [
      toolCall("store", "codemode", { code: 'store("value", 7);' }),
      toolCall("bad-store", "codemode", {
        code: 'store("value", 99); throw new Error("failed write");',
      }),
      toolCall("load", "codemode", { code: 'return load("value");' }),
      toolCall("search", "tool_search", { query: "lookup issues" }),
      toolCall("search-again", "tool_search", { query: "lookup issues" }),
    ];
    const next = calls[step++];
    return respond(model, next ? [next] : [{ type: "text", text: "done" }]);
  });
  await prompt(sdk, world.sessionId, "run");
  const load = await toolResultOf({ sdk, sessionId: world.sessionId, callId: "load" });
  assert.equal(load.isError, false);
  assert.ok(load.content.some((block) => block.type === "text" && block.text === "7"));
  const search = await toolResultOf({ sdk, sessionId: world.sessionId, callId: "search" });
  assert.deepEqual(search.addedToolNames, ["mcp__fixture__lookup"]);
  assert.equal(declarations[0]?.includes("mcp__fixture__lookup"), false);
  assert.equal(declarations[4]?.includes("mcp__fixture__lookup"), true);
  const repeated = await toolResultOf({ sdk, sessionId: world.sessionId, callId: "search-again" });
  assert.ok(
    repeated.content.some(
      (block) => block.type === "text" && block.text === "No matching tools found.",
    ),
  );
});

test.each(["codemode", "deferred"] as const)(
  "%s tools registered after code mode work without MCP namespaces",
  async (exposure) => {
    const world = TestWorkspace.create("nyte-codemode-late-");
    workspaces.push(world);
    let step = 0;
    const sdk = await world.open({
      model: testModel,
      plugins: [
        inlinePlugin(codemodePlugin()),
        inlinePlugin(
          definePlugin({
            id: "late-tools",
            session(api) {
              api.tools.add((draft) =>
                draft.set("late_lookup", {
                  name: "late_lookup",
                  description: "Look up a late fixture",
                  exposure,
                  parameters: Type.Object({}),
                  execute: async () => ({
                    content: [{ type: "text", text: "found" }],
                    details: {},
                  }),
                }),
              );
            },
          }),
        ),
      ],
      streamFn: (model, context) => {
        const names = getCurrentTools(context.messages).map((tool) => tool.name);
        assert.ok(names.includes("codemode") && names.includes("tool_search"));
        if (step++ === 0) {
          assert.ok(!names.includes("late_lookup"));
          return respond(model, [
            exposure === "codemode"
              ? toolCall("lookup", "codemode", { code: "return await tools.late_lookup({});" })
              : toolCall("search", "tool_search", { query: "late lookup" }),
          ]);
        }
        if (exposure === "deferred" && step === 2) {
          assert.ok(names.includes("late_lookup"));
          return respond(model, [toolCall("lookup", "late_lookup", {})]);
        }
        return respond(model, [{ type: "text", text: "done" }]);
      },
    });
    await prompt(sdk, world.sessionId, "look it up");
    const result = await toolResultOf({ sdk, sessionId: world.sessionId, callId: "lookup" });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.ok(result.content.some((block) => block.type === "text" && block.text === "found"));
  },
);

test("options truncate output to a private full-output file and timeouts keep partial output", async () => {
  const result = await executeCodemode({
    toolCallId: "truncate",
    code: '// @options: {"max_output_tokens": 2}\ntext("prefix" + "x".repeat(200) + "suffix");',
  });
  const path = result.details.fullOutputPath;
  assert.ok(path);
  try {
    assert.equal(await readFile(path, "utf8"), `prefix${"x".repeat(200)}suffix`);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.ok(
      result.content.some(
        (block) => block.type === "text" && block.text.includes("tokens truncated"),
      ),
    );
  } finally {
    await rm(path);
  }
  await assert.rejects(
    executeCodemode({
      toolCallId: "timeout",
      code: '// @options: {"timeout_ms": 1000}\ntext("before timeout"); while (true) {}',
    }),
    (error: unknown) => {
      assert.ok(error instanceof ToolError);
      const text = error.result.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
      assert.match(text, /before timeout/);
      assert.match(text, /Script timed out/);
      return true;
    },
  );
});
