import { Type } from "typebox";
import { bindTool } from "../src/plugins/index.ts";
import { createLsTool, type LsToolInput } from "../src/tools/ls.ts";
import { createWriteTool } from "../src/tools/write.ts";
import { createAllTools } from "../src/tools/index.ts";
import type { createJobs } from "../src/kernel/sdk/jobs.ts";
import type { AgentTool } from "../src/kernel/loop/types.ts";
import { ToolMapDraft } from "../src/plugins/registry.ts";

const countSchema = Type.Object({ count: Type.Number() });
const countTool: AgentTool<typeof countSchema> = {
  name: "count",
  description: "Double a count",
  parameters: countSchema,
  execute: async (_id, args) => ({ content: [], details: args.count * 2 }),
};

export function toolTypeContracts() {
  // @ts-expect-error A typed executor cannot accept another schema's input.
  void countTool.execute("call", { text: "wrong schema" });
  // @ts-expect-error A typed executor must be bound before heterogeneous storage.
  const unchecked: AgentTool[] = [countTool];
  const checked: AgentTool[] = [bindTool(countTool)];
  bindTool({
    name: "bad",
    description: "An incompatible executor",
    parameters: countSchema,
    // @ts-expect-error The schema, not the executor, determines the input type.
    execute: async (_id, args: { text: string }) => ({ content: [], details: args.text }),
  });
  new ToolMapDraft().set("bad", {
    name: "bad",
    description: "An incompatible registry contribution",
    parameters: countSchema,
    // @ts-expect-error Registry contributions must pair the schema with its executor.
    execute: async (_id, args: { text: string }) => ({ content: [], details: args.text }),
  });
  return { unchecked, checked };
}

export function builtinTypeContracts(jobs: ReturnType<typeof createJobs>) {
  const ls = createLsTool("/tmp");
  const write = createWriteTool("/tmp");
  // @ts-expect-error The factory's schema requires a numeric limit.
  void ls.execute("call", { limit: "2" });
  // @ts-expect-error The public input type is derived from the same schema.
  const invalidInput: LsToolInput = { path: false };
  // @ts-expect-error A write executor cannot implement the ls schema.
  bindTool({ ...ls, execute: write.execute });
  // @ts-expect-error Heterogeneous factories must be bound before storage.
  const unchecked: AgentTool[] = [ls, write];
  // @ts-expect-error Jobs wrapping cannot erase a concrete executor unchecked.
  jobs.wrap(write);
  const checked: AgentTool[] = [bindTool(ls), bindTool(write)];
  const wrapped: AgentTool[] = createAllTools("/tmp").map((tool) => jobs.wrap(tool));
  return { invalidInput, unchecked, checked, wrapped };
}
