import type { TSchema } from "typebox";
import type { ExecutionEnv } from "../src/kernel/loop/env.ts";
import type { AgentTool, ExecutableTool } from "../src/kernel/loop/types.ts";
import { createBashToolDefinition } from "../src/tools/bash.ts";
import { bindTool } from "../src/tools/bind-tool.ts";
import { createEditToolDefinition } from "../src/tools/edit.ts";
import { createReadToolDefinition } from "../src/tools/read.ts";
import { createWriteToolDefinition } from "../src/tools/write.ts";
import { localEnv } from "./kernel/helpers.ts";

/** `tool` acting in `env`, bound the way a session's activation binds it. */
export function bindEnv<T extends TSchema, Details>(
  tool: AgentTool<T, Details>,
  env: ExecutionEnv,
): ExecutableTool<T, Details> {
  return { ...tool, execute: (input, call) => tool.execute(input, { ...call, env }) };
}

/** The coding tools `tools-fs` registers, bound and named outside a plugin host, acting at `cwd`. */
export function builtinTools(cwd: string): ExecutableTool[] {
  const env = localEnv(cwd);

  return [
    bindEnv(bindTool({ ...createReadToolDefinition(), name: "read" }), env),
    bindEnv(bindTool({ ...createBashToolDefinition(), name: "bash" }), env),
    bindEnv(bindTool({ ...createEditToolDefinition(), name: "edit" }), env),
    bindEnv(bindTool({ ...createWriteToolDefinition(), name: "write" }), env),
  ];
}
