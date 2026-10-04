import { Type } from "typebox";
import { bindTool } from "../src/plugins/index.ts";
import { createLsToolDefinition, type LsToolInput } from "../src/tools/ls.ts";
import { createWriteToolDefinition } from "../src/tools/write.ts";
import type { createJobs } from "../src/kernel/sdk/jobs.ts";
import type { AgentTool, ExecutableTool } from "../src/kernel/loop/types.ts";
import { ToolMapDraft } from "../src/plugins/registry.ts";
import { builtinTools } from "./builtin-tools.ts";
import { toolCall } from "./kernel/helpers.ts";

const countSchema = Type.Object({ count: Type.Number() });
const countTool: AgentTool<typeof countSchema> = {
  name: "count",
  description: "Double a count",
  parameters: countSchema,
  execute: async (input) => ({ content: [], details: input.count * 2 }),
};

export function toolTypeContracts() {
  // @ts-expect-error A typed executor cannot accept another schema's input.
  void countTool.execute({ text: "wrong schema" }, toolCall("call"));
  // @ts-expect-error A typed executor must be bound before heterogeneous storage.
  const unchecked: AgentTool[] = [countTool];
  const checked: AgentTool[] = [bindTool(countTool)];
  // @ts-expect-error An authored tool must be bound before the loop runs it.
  const loop: ExecutableTool[] = [bindTool(countTool)];
  bindTool({
    name: "bad",
    description: "An incompatible executor",
    parameters: countSchema,
    // @ts-expect-error The schema, not the executor, determines the input type.
    execute: async (input: { text: string }) => ({ content: [], details: input.text }),
  });
  new ToolMapDraft().set("bad", {
    name: "bad",
    description: "An incompatible registry contribution",
    parameters: countSchema,
    // @ts-expect-error Registry contributions must pair the schema with its executor.
    execute: async (input: { text: string }) => ({ content: [], details: input.text }),
  });
  return { unchecked, checked, loop };
}

export function builtinTypeContracts(jobs: ReturnType<typeof createJobs>) {
  const ls = { ...createLsToolDefinition(), name: "ls" };
  const write = { ...createWriteToolDefinition(), name: "write" };
  // @ts-expect-error The factory's schema requires a numeric limit.
  void ls.execute({ limit: "2" }, toolCall("call"));
  // @ts-expect-error The public input type is derived from the same schema.
  const invalidInput: LsToolInput = { path: false };
  // @ts-expect-error A write executor cannot implement the ls schema.
  bindTool({ ...ls, execute: write.execute });
  // @ts-expect-error Heterogeneous factories must be bound before storage.
  const unchecked: AgentTool[] = [ls, write];
  // @ts-expect-error Jobs wrapping cannot erase a concrete executor unchecked.
  jobs.wrap(write);
  const checked: AgentTool[] = [bindTool(ls), bindTool(write)];
  const wrapped: AgentTool[] = builtinTools("/tmp").map((tool) => jobs.wrap(tool));
  return { invalidInput, unchecked, checked, wrapped };
}
