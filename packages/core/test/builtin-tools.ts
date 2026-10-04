import type { AgentTool } from "../src/kernel/loop/types.ts";
import { createBashToolDefinition } from "../src/tools/bash.ts";
import { bindTool } from "../src/tools/bind-tool.ts";
import { createEditToolDefinition } from "../src/tools/edit.ts";
import { createLocalExecutionEnv, withExecutionEnv } from "../src/tools/env.ts";
import { createReadToolDefinition } from "../src/tools/read.ts";
import { createWriteToolDefinition } from "../src/tools/write.ts";

/** The coding tools `tools-fs` registers, bound and named outside a plugin host, acting at `cwd`. */
export function builtinTools(cwd: string): AgentTool[] {
  const env = createLocalExecutionEnv({ cwd });

  return [
    withExecutionEnv(bindTool({ ...createReadToolDefinition(), name: "read" }), env),
    withExecutionEnv(bindTool({ ...createBashToolDefinition(), name: "bash" }), env),
    withExecutionEnv(bindTool({ ...createEditToolDefinition(), name: "edit" }), env),
    withExecutionEnv(bindTool({ ...createWriteToolDefinition(), name: "write" }), env),
  ];
}
