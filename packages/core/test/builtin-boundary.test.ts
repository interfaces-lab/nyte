import assert from "node:assert/strict";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "vitest";
import { createToolArgumentParser } from "@nyte-ai/ai/utils/validation";
import { executeToolCalls } from "../src/agent-loop.ts";
import { bindTool } from "../src/plugins/index.ts";
import { createAllTools } from "../src/tools/index.ts";
import { createLsTool } from "../src/tools/ls.ts";
import { createRegistries } from "../src/plugins/host.ts";
import { toolResultText } from "../src/utils/tool-result.ts";
import type { AgentLoopConfig } from "../src/types.ts";
import { assistant, call, storePath } from "./kernel/helpers.ts";

const config: AgentLoopConfig = {
  model: {
    id: "test",
    name: "test",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  },
};

test("ls retains preparer rejection while schema parsing coerces and omits optional nulls", async () => {
  const directory = dirname(storePath());
  await writeFile(join(directory, "a.txt"), "a");
  await writeFile(join(directory, "b.txt"), "b");
  const ls = createLsTool(directory);
  const parse = createToolArgumentParser(ls);
  assert.deepEqual(parse({ path: null, limit: "1" }), { limit: 1 });
  assert.deepEqual(parse({ limit: null }), {});
  assert.deepEqual(ls.prepareArguments?.({ ignored: true }), {});
  assert.throws(() => ls.prepareArguments?.({ limit: Number.NaN }), /limit must be number/);
  for (const args of [{ limit: "1" }, { limit: null }, { path: null }, { path: 1 }]) {
    const result = await executeToolCalls(
      { systemPrompt: "", messages: [], tools: [bindTool(ls)] },
      assistant("", { calls: [call("ls", "ls", args)] }),
      config,
      undefined,
      () => {},
    );
    assert.equal(result[0]?.isError, true);
  }
  const result = await executeToolCalls(
    { systemPrompt: "", messages: [], tools: [bindTool(ls)] },
    assistant("", { calls: [call("ls", "ls", { limit: 2 })] }),
    { ...config, beforeToolCall: async () => ({ args: { path: null, limit: "1" } }) },
    undefined,
    () => {},
  );
  assert.equal(result[0]?.isError, false);
  assert.deepEqual(result[0]?.details, { entryLimitReached: 1 });
  assert.match(toolResultText(result[0]?.content ?? []), /^a.txt\n/u);
});

test("ls skips entries that disappear after readdir and still marks surviving directories", async () => {
  const directory = dirname(storePath());
  await writeFile(join(directory, "gone"), "gone");
  await writeFile(join(directory, "z.txt"), "z");
  await mkdir(join(directory, "folder"));
  const ls = bindTool(
    createLsTool(directory, {
      operations: {
        exists: async () => true,
        stat,
        readdir: async (path) => {
          const entries = await readdir(path);
          await rm(join(path, "gone"));
          return entries;
        },
      },
    }),
  );
  assert.equal(toolResultText((await ls.execute("ls", {})).content), "folder/\nz.txt");
});

test("builtin registry contributions retain identity through rebuilds", () => {
  const registries = createRegistries();
  const tools = createAllTools("/tmp");
  registries.tools.add("builtin", 0, (draft) => {
    for (const tool of tools) draft.set(tool.name, tool);
  });
  assert.equal(registries.tools.rebuild().added.length, tools.length);
  assert.deepEqual(registries.tools.rebuild(), { added: [], removed: [], changed: [], errors: [] });
});
