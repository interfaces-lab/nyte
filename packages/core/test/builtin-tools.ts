import type { AgentTool } from "../src/kernel/loop/types.ts";
import { createBashToolDefinition } from "../src/tools/bash.ts";
import { bindTool } from "../src/tools/bind-tool.ts";
import { createEditToolDefinition } from "../src/tools/edit.ts";
import { createReadToolDefinition } from "../src/tools/read.ts";
import { createWriteToolDefinition } from "../src/tools/write.ts";

/** The coding tools `tools-fs` registers, bound and named outside a plugin host. */
export function builtinTools(cwd: string): AgentTool[] {
  return [
    bindTool({ ...createReadToolDefinition(cwd), name: "read" }),
    bindTool({ ...createBashToolDefinition(cwd), name: "bash" }),
    bindTool({ ...createEditToolDefinition(cwd), name: "edit" }),
    bindTool({ ...createWriteToolDefinition(cwd), name: "write" }),
  ];
}
