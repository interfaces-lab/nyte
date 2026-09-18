/**
 * Coding tool set ported from pi. read/bash/edit/write follow pi-agent-core's
 * tools; ls comes from pi-coding-agent, which is the only pi package
 * that has it. There is no grep or find tool; agents can run search commands
 * through bash.
 *
 * Based on https://github.com/earendil-works/pi/tree/main/packages/agent/src/harness/tools
 * and https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src/core/tools
 */
import type { AgentTool } from "../kernel/loop/types.ts";
import { createBashTool } from "./bash.ts";
import { bindTool } from "./bind-tool.ts";
import { createEditTool } from "./edit.ts";
import { createLsTool } from "./ls.ts";
import { createReadTool } from "./read.ts";
import { createWriteTool } from "./write.ts";

export function createAllTools(cwd: string): AgentTool[] {
  return [
    bindTool(createReadTool(cwd)),
    bindTool(createBashTool(cwd)),
    bindTool(createEditTool(cwd)),
    bindTool(createWriteTool(cwd)),
    bindTool(createLsTool(cwd)),
  ];
}
