import type { AgentTool } from "../kernel/loop/types.ts";
import { createBashTool } from "./bash.ts";
import { bindTool } from "./bind-tool.ts";
import { createEditTool } from "./edit.ts";
import { createReadTool } from "./read.ts";
import { createWriteTool } from "./write.ts";

export function createAllTools(cwd: string): AgentTool[] {
  return [
    bindTool(createReadTool(cwd)),
    bindTool(createBashTool(cwd)),
    bindTool(createEditTool(cwd)),
    bindTool(createWriteTool(cwd)),
  ];
}
