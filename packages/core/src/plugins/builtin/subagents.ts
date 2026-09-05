/**
 * Turns declared agents into one `task` tool. The SDK supplies the child
 * session operations because it owns the store and runners. The tool itself
 * only starts a child, parks, and reads the child's durable result on wake.
 */
import type { JsonValue } from "@nyte-ai/schema";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { ToolWait } from "../../types.ts";
import type { AgentTool, ToolWakeOutcome } from "../../types.ts";
import { toolResultContent } from "../../utils/tool-result.ts";
import { definePlugin, type Agent } from "../types.ts";

export const SUBAGENTS_PLUGIN_ID = "subagents";
export const TASK_TOOL = "task";

export interface TaskDetails {
  readonly agent: string;
  readonly childSessionId: string;
  readonly state: "running" | "completed" | "aborted" | "failed";
}

export type SubagentState =
  | { readonly kind: "running"; readonly childSessionId: string }
  | { readonly kind: "completed"; readonly childSessionId: string; readonly text: string }
  | { readonly kind: "failed"; readonly childSessionId: string; readonly error: string }
  | { readonly kind: "aborted"; readonly childSessionId: string };

export interface SubagentHost {
  spawn(input: {
    readonly agent: string;
    readonly prompt: string;
    readonly callId: string;
  }): Promise<
    | { readonly kind: "spawned"; readonly childSessionId: string }
    | { readonly kind: "depth_exceeded" }
  >;
  state(input: { readonly runId: string; readonly callId: string }): Promise<SubagentState>;
  abort(input: { readonly runId: string; readonly callId: string }): Promise<void>;
}

const taskParameters = Type.Object(
  {
    agent: Type.String({ minLength: 1, description: "The agent to delegate to." }),
    prompt: Type.String({
      minLength: 1,
      description: "The task, with all context the agent needs; it sees no prior conversation.",
    }),
  },
  { additionalProperties: false },
);

export type TaskInput = Static<typeof taskParameters>;

export function invokableAgents(agents: readonly Agent[]): readonly Agent[] {
  return agents.filter(
    (agent) => agent.disabled !== true && agent.hidden !== true && agent.mode !== "primary",
  );
}

export function buildTaskDescription(agents: readonly Agent[]): string {
  const lines = agents.map((agent) => `- ${agent.id}: ${agent.description ?? "(no description)"}`);
  return [
    "Delegate a task to a specialized agent that runs in its own session and",
    "returns a final result. Pick the agent whose description best fits the task.",
    "",
    "Available agents:",
    ...lines,
  ].join("\n");
}

function parseTaskInput(value: JsonValue): TaskInput {
  if (!Value.Check(taskParameters, value)) throw new Error("Task arguments are invalid");
  return value;
}

function settlement(input: TaskInput, state: SubagentState, aborted: boolean): ToolWakeOutcome {
  const details = (status: TaskDetails["state"]): TaskDetails => ({
    agent: input.agent,
    childSessionId: state.childSessionId,
    state: status,
  });
  if (aborted || state.kind === "aborted") {
    return {
      kind: "settle",
      isError: true,
      result: {
        content: toolResultContent("Task was aborted."),
        details: details("aborted"),
        title: input.agent,
      },
    };
  }
  switch (state.kind) {
    case "running":
      return { kind: "wait" };
    case "completed":
      return {
        kind: "settle",
        result: {
          content: toolResultContent(state.text === "" ? "(no result)" : state.text),
          details: details("completed"),
          title: input.agent,
        },
      };
    case "failed":
      return {
        kind: "settle",
        isError: true,
        result: {
          content: toolResultContent(`Task failed: ${state.error}`),
          details: details("failed"),
          title: input.agent,
        },
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function taskTool(
  agents: readonly Agent[],
  host: SubagentHost,
): AgentTool<typeof taskParameters, TaskDetails> {
  const ids = new Set(agents.map((agent) => agent.id));
  return {
    name: TASK_TOOL,
    description: buildTaskDescription(agents),
    parameters: taskParameters,
    promptSnippet: "Delegate a self-contained task to another agent",
    replay: "never",
    prepareArguments(value) {
      const input = parseTaskInput(value);
      if (!ids.has(input.agent)) {
        throw new Error(`Invalid arguments: agent must be one of ${[...ids].join(", ")}`);
      }
      return input;
    },
    async execute(toolCallId, input, _signal, onUpdate) {
      const spawned = await host.spawn({
        agent: input.agent,
        prompt: input.prompt,
        callId: toolCallId,
      });
      if (spawned.kind === "depth_exceeded") {
        throw new Error("Delegation depth is 1: a subagent cannot delegate further.");
      }
      onUpdate?.({
        content: toolResultContent(input.prompt),
        details: {
          agent: input.agent,
          childSessionId: spawned.childSessionId,
          state: "running",
        },
        title: input.agent,
      });
      throw new ToolWait();
    },
    wake: async (waiting, context) => {
      const input = parseTaskInput(waiting.args);
      const call = { runId: waiting.runId, callId: waiting.toolCallId };
      const state = await host.state(call);
      if (context.aborted && state.kind === "running") await host.abort(call);
      return settlement(input, state, context.aborted);
    },
  };
}

/** A host installs this only for root sessions it can run children for. */
export function subagentsPlugin(host: SubagentHost) {
  return definePlugin({
    id: SUBAGENTS_PLUGIN_ID,
    session(api) {
      api.tools.add((draft) => {
        const agents = invokableAgents(api.agents.list());
        if (agents.length > 0) draft.set(TASK_TOOL, taskTool(agents, host));
      });
    },
  });
}
