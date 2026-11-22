import type {
  PermissionOption,
  SessionUpdate,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk/unstable";
import { Type } from "typebox";
import { Value } from "typebox/value";

export type DialectName = "claude" | "copilot" | "devin";

export interface SubagentReport {
  readonly child: string;
  readonly title?: string;
  readonly status: "running" | "completed" | "failed";
  readonly result?: string;
}

export interface SessionSubagentReport extends SubagentReport {
  readonly sessionId: string;
}

export interface Dialect {
  readonly capabilityMeta?: Readonly<Record<string, unknown>>;
  readonly notifications: ReadonlyMap<
    string,
    (params: unknown) => SessionSubagentReport | undefined
  >;
  findSubagent(update: SessionUpdate): string | undefined;
  readSubagent(tool: ToolCallUpdate): SubagentReport | undefined;
  readTitle(tool: ToolCallUpdate): string | undefined;
  filterPermissionOptions(options: readonly PermissionOption[]): readonly PermissionOption[];
}

const anyRecord = Type.Record(Type.String(), Type.Unknown());

const devinSubagentStart = Type.Object({
  agentId: Type.String(),
  title: Type.Optional(Type.String()),
});

const devinSubagentEnd = Type.Object({
  agentId: Type.String(),
  success: Type.Optional(Type.Boolean()),
  summary: Type.Optional(Type.String()),
});

const devinSubagentContext = Type.Object({ parentAgentId: Type.String() });

const claudeAgentInput = Type.Object({
  prompt: Type.String(),
  description: Type.Optional(Type.String()),
  run_in_background: Type.Optional(Type.Boolean()),
});

const claudeToolMeta = Type.Object({ claudeCode: Type.Object({ toolName: Type.String() }) });

const copilotTaskInput = Type.Object({
  agent_type: Type.String(),
  prompt: Type.String(),
  description: Type.Optional(Type.String()),
  mode: Type.Optional(Type.String()),
});

const copilotTaskOutput = Type.Object({ content: Type.String() });

const copilotSessionEvent = Type.Object({
  sessionId: Type.String(),
  type: Type.String(),
  agentId: Type.Optional(Type.String()),
  data: Type.Optional(
    Type.Object({
      deltaContent: Type.Optional(Type.String()),
      parentToolCallId: Type.Optional(Type.String()),
      toolCallId: Type.Optional(Type.String()),
      error: Type.Optional(Type.String()),
    }),
  ),
});

const COPILOT_META = "github.com/copilot";

const copilotToolMeta = Type.Object({ agentId: Type.String() });

const DEVIN_SPAWN_TITLE = /^Ran \S+ subagent (?<title>.+)$/u;

const STANDARD: Dialect = {
  notifications: new Map(),
  findSubagent: () => undefined,
  readSubagent: () => undefined,
  readTitle: () => undefined,
  filterPermissionOptions: (options) => options,
};

export function createDialect(name: DialectName | undefined): Dialect {
  switch (name) {
    case "claude":
      return claudeDialect();
    case "copilot":
      return copilotDialect();
    case "devin":
      return devinDialect();
    case undefined:
      return STANDARD;
    default: {
      const exhaustive: never = name;

      return exhaustive;
    }
  }
}

function devinDialect(): Dialect {
  const unlinkedSpawns: string[] = [];
  const spawnByAgent = new Map<string, string>();
  const childId = (agentId: string) => spawnByAgent.get(agentId) ?? agentId;

  return {
    ...STANDARD,
    findSubagent(update) {
      const context = readProperty(readMeta(update), "cognition.ai/subagent_context");

      return Value.Check(devinSubagentContext, context) && context.parentAgentId !== "root"
        ? childId(context.parentAgentId)
        : undefined;
    },
    readSubagent(tool) {
      const end = readProperty(readMeta(tool), "cognition.ai/subagent_completed");

      if (Value.Check(devinSubagentEnd, end)) {
        return {
          child: childId(end.agentId),
          status: end.success === false ? "failed" : "completed",
          result: end.summary,
        };
      }

      const start = readProperty(readMeta(tool), "cognition.ai/subagent_started");

      if (Value.Check(devinSubagentStart, start)) {
        const spawn = unlinkedSpawns.shift();

        if (spawn !== undefined) spawnByAgent.set(start.agentId, spawn);

        return { child: childId(start.agentId), title: start.title, status: "running" };
      }

      const finished = tool.status === "completed" || tool.status === "failed";
      const seen =
        unlinkedSpawns.includes(tool.toolCallId) ||
        [...spawnByAgent.values()].includes(tool.toolCallId);
      const spawning =
        readProperty(readMeta(tool), "cognition.ai/inferenceToolName") === "run_subagent";

      if (!spawning || finished || seen) return undefined;
      unlinkedSpawns.push(tool.toolCallId);

      return {
        child: tool.toolCallId,
        title: DEVIN_SPAWN_TITLE.exec(tool.title ?? "")?.groups?.title,
        status: "running",
      };
    },
    readTitle(tool) {
      const name = readProperty(readMeta(tool), "cognition.ai/inferenceToolName");
      const untitled = tool.title === undefined || tool.title === "Tool";

      return Value.Check(Type.String(), name) && name !== "run_subagent" && untitled
        ? name
        : undefined;
    },
    filterPermissionOptions: (options) =>
      options.filter((option) => option.optionId.trim() !== "plan_bypass"),
  };
}

function claudeDialect(): Dialect {
  return {
    ...STANDARD,
    readSubagent(tool) {
      const meta = readMeta(tool);
      const name = Value.Check(claudeToolMeta, meta) ? meta.claudeCode.toolName : undefined;

      if ((name !== "Agent" && name !== "Task") || !Value.Check(claudeAgentInput, tool.rawInput)) {
        return undefined;
      }

      return {
        child: tool.toolCallId,
        title: tool.rawInput.description,
        status: subagentStatus(tool, tool.rawInput.run_in_background === true),
      };
    },
  };
}

function copilotDialect(): Dialect {
  const taskByAgent = new Map<string, string>();
  let lastDelta: { readonly text: string; readonly task: string | undefined } | undefined;

  const readSessionEvent = (params: unknown): SessionSubagentReport | undefined => {
    if (!Value.Check(copilotSessionEvent, params)) return undefined;
    const data = params.data ?? {};
    const toolCallId = data.toolCallId;

    switch (params.type) {
      case "assistant.message_delta":
      case "assistant.reasoning_delta":
        if (data.deltaContent !== undefined) {
          lastDelta = {
            text: data.deltaContent,
            task:
              data.parentToolCallId ??
              (params.agentId === undefined ? undefined : taskByAgent.get(params.agentId)),
          };
        }

        return undefined;
      case "subagent.started":
        if (params.agentId !== undefined && toolCallId !== undefined) {
          taskByAgent.set(params.agentId, toolCallId);
        }

        return undefined;
      case "subagent.completed":
      case "subagent.failed":
        if (params.agentId !== undefined) taskByAgent.delete(params.agentId);

        return toolCallId === undefined
          ? undefined
          : {
              sessionId: params.sessionId,
              child: copilotChildId(toolCallId),
              status: params.type === "subagent.failed" ? "failed" : "completed",
              result: data.error,
            };
      default:
        return undefined;
    }
  };

  return {
    ...STANDARD,
    capabilityMeta: {
      [COPILOT_META]: {
        events: [
          "subagent.started",
          "subagent.completed",
          "subagent.failed",
          "assistant.message_delta",
          "assistant.reasoning_delta",
        ],
      },
    },
    notifications: new Map([[`${COPILOT_META}/sessionEvent`, readSessionEvent]]),
    findSubagent(update) {
      if (
        update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk"
      ) {
        const previous = lastDelta;
        lastDelta = undefined;
        const sameText = update.content.type === "text" && update.content.text === previous?.text;

        return previous?.task !== undefined && sameText ? copilotChildId(previous.task) : undefined;
      }

      if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
        return undefined;
      }

      const meta = readProperty(readMeta(update), COPILOT_META);
      const task = Value.Check(copilotToolMeta, meta) ? taskByAgent.get(meta.agentId) : undefined;

      return task === undefined ? undefined : copilotChildId(task);
    },
    readSubagent(tool) {
      if (!Value.Check(copilotTaskInput, tool.rawInput)) return undefined;
      const output = Value.Check(copilotTaskOutput, tool.rawOutput)
        ? tool.rawOutput.content
        : undefined;
      const status = subagentStatus(tool, tool.rawInput.mode === "background");

      return {
        child: copilotChildId(tool.toolCallId),
        title: tool.rawInput.description,
        status,
        result: status === "running" ? undefined : output,
      };
    },
  };
}

function readProperty(source: unknown, key: string): unknown {
  return Value.Check(anyRecord, source) ? source[key] : undefined;
}

function readMeta(source: unknown): unknown {
  return readProperty(source, "_meta");
}

function copilotChildId(taskToolCallId: string): string {
  return `copilot-task:${taskToolCallId}`;
}

function subagentStatus(tool: ToolCallUpdate, background: boolean): SubagentReport["status"] {
  if (tool.status === "failed") return "failed";

  return tool.status === "completed" && !background ? "completed" : "running";
}
