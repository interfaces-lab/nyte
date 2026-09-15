/** Shared task tool. The SDK owns child sessions and job lifecycle. */
import { MODEL_THINKING_LEVELS, type Api, type Model } from "@nyte-ai/schema";
import type { JobActionOutcome, JobInfo } from "@nyte-ai/protocol";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { AgentTool } from "../../types.ts";
import { ToolError, toolResultContent } from "../../utils/tool-result.ts";
import { definePlugin } from "../types.ts";

export const SUBAGENTS_PLUGIN_ID = "subagents";
export const TASK_TOOL = "task";
export const STOP_TASK_TOOL = "stop_task";
export const WAIT_TASK_TOOL = "wait_task";

const DEFAULT_TASK_MODEL = "openai-codex/gpt-5.6-sol";
const DEFAULT_TASK_THINKING_LEVEL = "high";

export interface TaskDetails {
  readonly model: string;
  readonly childSessionId: string;
  readonly state: "running" | SubagentResult["kind"];
}

export type SubagentResult =
  | { readonly kind: "completed"; readonly text: string }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "aborted" };

export type WaitTaskOutcome =
  | { readonly kind: "not_found" }
  /** The wait gave the turn back to queued user input. The task keeps running. */
  | { readonly kind: "still_running" }
  | {
      readonly kind: "finished";
      readonly state: Exclude<JobInfo["state"], "running">;
      readonly report: string;
    };

export interface SubagentHost {
  stop(jobId: string): Promise<JobActionOutcome>;
  /**
   * Observe an owned task job until it ends or the user queues input the wait is
   * holding up. Aborting the wait leaves the task running.
   */
  waitFor(input: {
    readonly jobId: string;
    readonly signal?: AbortSignal;
  }): Promise<WaitTaskOutcome>;
  spawn(
    input: Omit<TaskInput, "model" | "thinkingLevel"> & {
      readonly model: string;
      readonly thinkingLevel: NonNullable<TaskInput["thinkingLevel"]>;
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

const modelDescription = `Exact provider/model. Omit to use ${DEFAULT_TASK_MODEL}. Use an explicit value when the user requests another model. Unavailable models fail without substitution.`;

const taskParameters = Type.Object(
  {
    model: Type.Optional(
      Type.String({
        pattern: "^[^/]+/.+$",
        description: modelDescription,
      }),
    ),
    thinkingLevel: Type.Optional(
      Type.Enum(MODEL_THINKING_LEVELS, {
        description: `Thinking level for this task. Omit to use ${DEFAULT_TASK_THINKING_LEVEL}.`,
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
        "Task instructions and expected result. Point to relevant source files and include only context the child needs.",
    }),
    background: Type.Optional(
      Type.Boolean({
        description:
          "Return a job id immediately instead of waiting. The report is delivered before your next response while you are still working, or with the user's next message once you have finished. Call wait_task with the job id when you need the report sooner.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type TaskInput = Static<typeof taskParameters>;

/** `stop_task` and `wait_task` both address an owned job by its id. */
const taskJobParameters = Type.Object(
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
      model: Type.Optional(
        Type.Enum([...new Set(models.map((model) => `${model.provider}/${model.id}`))], {
          description: modelDescription,
        }),
      ),
    },
    { additionalProperties: false },
  );
}

/** Installed only in root sessions. */
export function subagentsPlugin(host: SubagentHost) {
  const tool: AgentTool<typeof taskParameters, TaskDetails> = {
    name: TASK_TOOL,
    description: `Runs a task in a separate session with no prior conversation. Defaults to ${DEFAULT_TASK_MODEL} with ${DEFAULT_TASK_THINKING_LEVEL} thinking unless the user requests another model or thinking level.
Waits for the final report by default. If the user sends something while you wait, the task moves to the background and this call returns its job id instead of the report; answer the user and let the report reach you. Use background=true when you can continue without the result; when you later need it, call wait_task with the returned job id. A finished background report joins your active run or waits for the user's next message; it never starts a new turn on its own.
Never poll, sleep, or relaunch a task to check progress. Use stop_task with the returned job id to cancel it.`,
    parameters: taskParameters,
    replay: "never",
    prepareArguments(value) {
      if (!Value.Check(taskParameters, value)) {
        throw new Error(
          "Task arguments are invalid. Provide a nonempty prompt. If set, model must be an exact provider/model; only model, thinkingLevel, title, and background are optional.",
        );
      }
      return value;
    },
    async execute(toolCallId, input, signal, onUpdate, context) {
      if (context === undefined) throw new Error("Task execution requires a run context");
      const model = input.model ?? DEFAULT_TASK_MODEL;
      const thinkingLevel = input.thinkingLevel ?? DEFAULT_TASK_THINKING_LEVEL;
      const title = input.title ?? model;
      const childSessionId = await host.spawn({
        ...input,
        model,
        thinkingLevel,
        callId: toolCallId,
        runId: context.runId,
        head: context.head,
        signal,
      });
      const details = { model, childSessionId };
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
  const stopTool: AgentTool<typeof taskJobParameters> = {
    name: STOP_TASK_TOOL,
    description:
      "Stop a task started by this session using its job id. Cancels the child agent and its running work. Already finished tasks are unchanged.",
    parameters: taskJobParameters,
    replay: "never",
    prepareArguments(value) {
      if (!Value.Check(taskJobParameters, value)) {
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
  const waitTool: AgentTool<typeof taskJobParameters> = {
    name: WAIT_TASK_TOOL,
    description:
      'Wait for a task this session already started and return its report, by job id. The wait is durable and never re-runs the task. It returns with the task still running if the user sends something meanwhile; the report still reaches you as a "Background" message, so answer the user rather than waiting again. Cancelling only this wait leaves the task running; stop_task cancels the task itself. Aborting a run still cancels that run\'s own tasks.',
    parameters: taskJobParameters,
    replay: "never",
    prepareArguments(value) {
      if (!Value.Check(taskJobParameters, value)) {
        throw new Error("Wait task arguments are invalid. Provide a nonempty jobId.");
      }
      return value;
    },
    async execute(_toolCallId, input, signal) {
      const outcome = await host.waitFor({ jobId: input.jobId, signal });
      if (outcome.kind === "not_found") {
        throw new ToolError({
          content: toolResultContent(`Task job not found in this session: ${input.jobId}`),
          details: { jobId: input.jobId, state: "not_found" },
        });
      }
      if (outcome.kind === "still_running") {
        return {
          content: toolResultContent(
            `Task ${input.jobId} is still running. This wait ended so the user's message can land: read it and answer it. The report reaches you as a "Background" message; wait again only if you need it before you reply.`,
          ),
          details: { jobId: input.jobId, state: "running" },
        };
      }
      const result = {
        content: toolResultContent(
          outcome.report ||
            (outcome.state === "completed" ? "(no result)" : `Task ${outcome.state}.`),
        ),
        details: { jobId: input.jobId, state: outcome.state },
      };
      if (outcome.state !== "completed") throw new ToolError(result);
      return result;
    },
  };
  return definePlugin({
    id: SUBAGENTS_PLUGIN_ID,
    session(api) {
      api.tools.add((draft) => {
        draft.set(TASK_TOOL, tool);
        draft.set(STOP_TASK_TOOL, stopTool);
        draft.set(WAIT_TASK_TOOL, waitTool);
      });
    },
  });
}
