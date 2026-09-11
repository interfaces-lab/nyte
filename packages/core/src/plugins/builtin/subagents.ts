/** Shared task tool. The SDK owns child sessions and job lifecycle. */
import { MODEL_THINKING_LEVELS, type Api, type Model } from "@nyte-ai/schema";
import type { JobActionOutcome } from "@nyte-ai/protocol";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { AgentTool } from "../../types.ts";
import { ToolError, toolResultContent } from "../../utils/tool-result.ts";
import { definePlugin } from "../types.ts";

export const SUBAGENTS_PLUGIN_ID = "subagents";
export const TASK_TOOL = "task";
export const STOP_TASK_TOOL = "stop_task";

export interface TaskDetails {
  readonly model: string;
  readonly childSessionId: string;
  readonly state: "running" | SubagentResult["kind"];
}

export type SubagentResult =
  | { readonly kind: "completed"; readonly text: string }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "aborted" };

export interface SubagentHost {
  stop(jobId: string): Promise<JobActionOutcome>;
  spawn(
    input: TaskInput & {
      readonly callId: string;
      readonly runId: string;
      readonly head: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<string>;
  wait(input: {
    readonly childSessionId: string;
    readonly signal?: AbortSignal;
  }): Promise<SubagentResult>;
}

const modelDescription =
  "Exact provider/model. Use the user's requested model, or choose one suited to the task. Unavailable models fail without substitution.";

const taskParameters = Type.Object(
  {
    model: Type.String({
      pattern: "^[^/]+/.+$",
      description: modelDescription,
    }),
    thinkingLevel: Type.Optional(
      Type.Enum(MODEL_THINKING_LEVELS, {
        description: "Thinking level for this task. Omit to inherit the parent's level.",
      }),
    ),
    title: Type.Optional(
      Type.String({
        minLength: 1,
        description: "A short task title, three to six words.",
      }),
    ),
    prompt: Type.String({
      minLength: 1,
      description:
        "Task instructions, including the subagent's role, context, constraints, and expected report.",
    }),
    background: Type.Optional(
      Type.Boolean({
        description:
          "Return a job id immediately instead of waiting. The report arrives later as a new message.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type TaskInput = Static<typeof taskParameters>;

const stopTaskParameters = Type.Object(
  {
    jobId: Type.String({
      minLength: 1,
      description: "Job id returned when the task was started in the background.",
    }),
  },
  { additionalProperties: false },
);

/** Each provider request receives the current cross-provider availability, not a session snapshot. */
export function taskModelParameters(models: readonly Pick<Model<Api>, "provider" | "id">[]) {
  return Type.Object(
    {
      ...taskParameters.properties,
      model: Type.Enum([...new Set(models.map((model) => `${model.provider}/${model.id}`))], {
        description: modelDescription,
      }),
    },
    { additionalProperties: false },
  );
}

/** Installed only in root sessions. */
export function subagentsPlugin(host: SubagentHost) {
  const tool: AgentTool<typeof taskParameters, TaskDetails> = {
    name: TASK_TOOL,
    description: `Runs a task on the selected model in a separate session with no prior conversation.
Waits for the final report by default. Use background=true to keep working, then finish your turn to receive the report.
Never poll, sleep, or relaunch a task to check progress. Use stop_task with the returned job id to cancel it.`,
    parameters: taskParameters,
    promptSnippet: "Run a task in a separate agent session",
    replay: "never",
    prepareArguments(value) {
      if (!Value.Check(taskParameters, value)) {
        throw new Error(
          "Task arguments are invalid. Provide an exact provider/model and a nonempty prompt. Only thinkingLevel, title, and background are optional.",
        );
      }
      return value;
    },
    async execute(toolCallId, input, signal, onUpdate, context) {
      if (context === undefined) throw new Error("Task execution requires a run context");
      const title = input.title ?? input.model;
      const childSessionId = await host.spawn({
        ...input,
        callId: toolCallId,
        runId: context.runId,
        head: context.head,
        signal,
      });
      const details = { model: input.model, childSessionId };
      onUpdate?.({
        content: toolResultContent(input.prompt),
        details: { ...details, state: "running" },
        title,
      });
      const state = await host.wait({ childSessionId, signal });
      const result = {
        content: toolResultContent(
          state.kind === "completed"
            ? state.text || "(no result)"
            : state.kind === "aborted"
              ? "Task was aborted."
              : `Task failed: ${state.error}`,
        ),
        details: { ...details, state: state.kind },
        title,
      };
      if (state.kind !== "completed") throw new ToolError(result);
      return result;
    },
  };
  const stopTool: AgentTool<typeof stopTaskParameters> = {
    name: STOP_TASK_TOOL,
    description:
      "Stop a task started by this session using its job id. Cancels the child agent and its running work. Already finished tasks are unchanged.",
    parameters: stopTaskParameters,
    promptSnippet: "Stop a running task by job id",
    replay: "never",
    prepareArguments(value) {
      if (!Value.Check(stopTaskParameters, value)) {
        throw new Error("Stop task arguments are invalid. Provide a nonempty jobId.");
      }
      return value;
    },
    async execute(_toolCallId, input, signal) {
      signal?.throwIfAborted();
      const outcome = await host.stop(input.jobId);
      const result = {
        content: toolResultContent(
          outcome.kind === "applied"
            ? `Task ${input.jobId} stopped.`
            : outcome.kind === "finished"
              ? `Task ${input.jobId} has already finished.`
              : `Task job not found in this session: ${input.jobId}`,
        ),
        details: { jobId: input.jobId, kind: outcome.kind },
      };
      if (outcome.kind === "not_found") throw new ToolError(result);
      return result;
    },
  };
  return definePlugin({
    id: SUBAGENTS_PLUGIN_ID,
    session(api) {
      api.tools.add((draft) => {
        draft.set(TASK_TOOL, tool);
        draft.set(STOP_TASK_TOOL, stopTool);
      });
    },
  });
}
