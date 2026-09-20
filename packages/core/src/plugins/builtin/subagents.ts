/**
 * The delegation tools a root session offers its model: children are sessions
 * the parent addresses by id. The SDK owns the child sessions, the requests it
 * sends them, and the completions their answers land as (`sdk/delegation.ts`).
 */
import {
  MODEL_THINKING_LEVELS,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from "@nyte-ai/schema";
import { type JobReport, type RunPhase, type SessionId, type ToolClass } from "@nyte-ai/protocol";
import { completionText, isJsonObject } from "@nyte-ai/client";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  ToolWait,
  type AgentTool,
  type AgentToolResult,
  type ToolPresentContext,
  type ToolWakeContext,
} from "../../kernel/loop/types.ts";
import { ToolError, toolResultContent } from "../../kernel/loop/tool-result.ts";
import { definePlugin } from "../types.ts";

export const SUBAGENTS_PLUGIN_ID = "subagents";
export const TASK_TOOL = "task";

const DEFAULT_TASK_MODEL = "openai-codex/gpt-5.6-sol";
const DEFAULT_TASK_THINKING_LEVEL = "high";
const DEFAULT_TASK_WAIT_MS = 120_000;
const DEFAULT_READ_TURNS = 5;
const TITLE_LIMIT = 60;

export type AgentReport = Extract<JobReport, { readonly kind: "delegate" }>;
/** Where a child stands when it has no ended request: never sent to, sent to but not yet answering, or its run's phase. */
export type AgentPhase = "idle" | "queued" | RunPhase["kind"];

/** What `await` knows about one agent: its latest request's report, or where it stands. */
export type AgentStatus =
  | { readonly kind: "report"; readonly report: AgentReport }
  | {
      readonly kind: "phase";
      readonly session: SessionId;
      readonly title: string;
      readonly phase: AgentPhase;
    }
  | { readonly kind: "not_found"; readonly session: SessionId };

export interface SubagentHost {
  /** The child a `task` call owns: the same derivation the host names it by, so a wake finds it. */
  childOf(head: string, runId: string, callId: string): SessionId;
  create(input: {
    readonly title: string;
    readonly model: string;
    readonly thinkingLevel: ModelThinkingLevel;
    readonly system?: string;
    readonly runId: string;
    readonly callId: string;
    readonly head: string;
    readonly signal?: AbortSignal;
  }): Promise<SessionId>;
  /** Enqueue on the child's main head as this run. The answer lands on `head` as a completion. */
  send(input: {
    readonly agent: SessionId;
    readonly message: string;
    readonly runId: string;
    readonly callId: string;
    readonly head: string;
  }): Promise<
    | { readonly kind: "sent"; readonly title: string }
    | { readonly kind: "stopped"; readonly title: string }
    | { readonly kind: "not_found" }
  >;
  /** Each agent's latest request as it stands now. Never parks. */
  status(agents: readonly SessionId[]): Promise<readonly AgentStatus[]>;
  read(input: { readonly agent: SessionId; readonly turns: number }): Promise<
    | {
        readonly kind: "read";
        readonly title: string;
        readonly phase: AgentPhase;
        readonly text: string;
      }
    | { readonly kind: "not_found" }
  >;
  stop(
    agent: SessionId,
  ): Promise<{ readonly kind: "stopped"; readonly title: string } | { readonly kind: "not_found" }>;
  /** Whether user input a parked call would hold up is queued on `head`. */
  inputPending(head: string): Promise<boolean>;
}

const modelDescription = `Exact provider/model. Omit to use ${DEFAULT_TASK_MODEL}. Use an explicit value when the user requests another model. Unavailable models fail without substitution.`;
const modelParameter = Type.Optional(
  Type.String({ pattern: "^[^/]+/.+$", description: modelDescription }),
);
const thinkingParameter = Type.Optional(
  Type.Enum(MODEL_THINKING_LEVELS, {
    description: `Thinking level for the agent. Omit to use ${DEFAULT_TASK_THINKING_LEVEL}.`,
  }),
);
const agentParameter = Type.Unsafe<SessionId>({
  type: "string",
  minLength: 1,
  description: "The agent's session id, as returned by create or task.",
});
const waitParameter = (description: string) =>
  Type.Optional(Type.Integer({ minimum: 0, description }));

const taskParameters = Type.Object(
  {
    prompt: Type.String({
      minLength: 1,
      description:
        "Task instructions and expected result. Point to relevant source files and include only context the agent needs.",
    }),
    title: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "A short name for the agent, three to six words. Defaults to the prompt's first line.",
      }),
    ),
    model: modelParameter,
    thinkingLevel: thinkingParameter,
    waitMs: waitParameter(
      `How long to wait for the report before returning what is known, in milliseconds. Defaults to ${DEFAULT_TASK_WAIT_MS}.`,
    ),
  },
  { additionalProperties: false },
);
export type TaskInput = Static<typeof taskParameters>;

const createParameters = Type.Object(
  {
    title: Type.String({
      minLength: 1,
      description: "A short name for the agent, three to six words.",
    }),
    model: modelParameter,
    thinkingLevel: thinkingParameter,
    system: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Instructions the agent keeps for every message: its role and constraints.",
      }),
    ),
  },
  { additionalProperties: false },
);

const sendParameters = Type.Object(
  {
    agent: agentParameter,
    message: Type.String({ minLength: 1, description: "The message the agent answers next." }),
    waitMs: waitParameter(
      "Wait this long for the answer before returning, in milliseconds. Omit to return a receipt at once.",
    ),
  },
  { additionalProperties: false },
);

export const awaitParameters = Type.Object(
  {
    agents: Type.Array(agentParameter, { minItems: 1, description: "The agents to wait for." }),
    mode: Type.Enum(["any", "all"], {
      description: "Return once any listed agent has answered, or only once all have.",
    }),
    timeoutMs: Type.Integer({
      minimum: 0,
      description: "Return after this long with whatever is known, in milliseconds.",
    }),
  },
  { additionalProperties: false },
);

const readParameters = Type.Object(
  {
    agent: agentParameter,
    turns: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: `How many of the latest turns to read. Defaults to ${DEFAULT_READ_TURNS}.`,
      }),
    ),
  },
  { additionalProperties: false },
);

const stopParameters = Type.Object({ agent: agentParameter }, { additionalProperties: false });

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

export interface AgentDetails {
  readonly agent: SessionId;
}

export interface AwaitDetails {
  readonly agents: readonly AgentStatus[];
}

export function taskTitle(input: TaskInput): string {
  if (input.title !== undefined) return input.title;
  const line = input.prompt.split("\n", 1)[0]?.trim() ?? "";
  return line.length > TITLE_LIMIT
    ? `${line.slice(0, TITLE_LIMIT - 1)}…`
    : line || DEFAULT_TASK_MODEL;
}

/**
 * The agents a parked call waits for, from the call's durable intent. `task`
 * and `send` wait for one; `await` names its own. Anything else waits for none.
 */
export function awaitedAgents(
  intent: {
    readonly tool: string;
    readonly args: unknown;
    readonly runId: string;
    readonly callId: string;
  },
  childOf: (runId: string, callId: string) => SessionId,
):
  | {
      readonly kind: "awaited";
      readonly agents: readonly SessionId[];
      readonly mode: "any" | "all";
    }
  | { readonly kind: "not_awaited" } {
  switch (intent.tool) {
    case TASK_TOOL:
      return {
        kind: "awaited",
        agents: [childOf(intent.runId, intent.callId)],
        mode: "all",
      };
    case "send":
      return Value.Check(sendParameters, intent.args)
        ? { kind: "awaited", agents: [intent.args.agent], mode: "all" }
        : { kind: "not_awaited" };
    case "await":
      return Value.Check(awaitParameters, intent.args)
        ? { kind: "awaited", agents: intent.args.agents, mode: intent.args.mode }
        : { kind: "not_awaited" };
    default:
      return { kind: "not_awaited" };
  }
}

/** Whether what is known satisfies the wait: one report in `any`, every one in `all`. */
export function satisfied(statuses: readonly AgentStatus[], mode: "any" | "all"): boolean {
  const reported = statuses.map((status) => status.kind === "report");
  return mode === "any" ? reported.some(Boolean) : reported.every(Boolean);
}

function statusTitle(status: AgentStatus): string {
  switch (status.kind) {
    case "report":
      return status.report.title;
    case "phase":
      return status.title;
    case "not_found":
      return status.session;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function statusText(status: AgentStatus): string {
  switch (status.kind) {
    case "report":
      return completionText(status.report);
    case "phase":
      return `Agent ${status.title} (${status.session}) is ${status.phase}; no report yet.`;
    case "not_found":
      return `No agent ${status.session} belongs to this session.`;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

type WaitEnd = "settled" | "timeout" | "yield" | "cancelled";

const WAIT_END_TEXT: Record<Exclude<WaitEnd, "settled">, string> = {
  timeout:
    'The wait reached its timeout; the agents keep working. Call await again when you need them, or let each report reach you as a "Background" message.',
  yield:
    'This wait ended so the user\'s message can land: read it and answer it. Reports still reach you as "Background" messages.',
  cancelled: "This wait was cancelled because the run was stopped. The agents keep working.",
};

interface WaitOutcome<Details> {
  readonly result: AgentToolResult<Details>;
  readonly isError: boolean;
}

function awaitResult(statuses: readonly AgentStatus[], end: WaitEnd): WaitOutcome<AwaitDetails> {
  const first = statuses[0];
  const result: AgentToolResult<AwaitDetails> = {
    content: toolResultContent(
      [...statuses.map(statusText), ...(end === "settled" ? [] : [WAIT_END_TEXT[end]])].join(
        "\n\n",
      ),
    ),
    details: { agents: statuses },
    ...(first === undefined ? {} : { title: statusTitle(first) }),
  };
  const failed =
    end === "cancelled" ||
    statuses.some((status) => status.kind === "not_found") ||
    (statuses.length > 0 &&
      statuses.every(
        (status) => status.kind === "report" && status.report.end.kind !== "completed",
      ));
  return { result, isError: failed };
}

/** Installed only in root sessions. */
export function subagentsPlugin(host: SubagentHost) {
  const presentChild = (_input: unknown, context: ToolPresentContext): ToolClass => ({
    kind: "delegate",
    role: "create",
    target: {
      kind: "one",
      session: host.childOf(context.head, context.runId, context.callId),
    },
  });
  /** Park on `agents` until `mode` is satisfied, `timeoutMs` passes, or the user's input needs the turn. */
  const awaitAgents = async (
    agents: readonly SessionId[],
    mode: "any" | "all",
    timeoutMs: number,
    head: string,
  ) => {
    const statuses = await host.status(agents);
    if (satisfied(statuses, mode) || statuses.some((status) => status.kind === "not_found"))
      return awaitResult(statuses, "settled");
    if (timeoutMs === 0) return awaitResult(statuses, "timeout");
    if (await host.inputPending(head)) return awaitResult(statuses, "yield");
    throw new ToolWait({ until: Date.now() + timeoutMs });
  };
  const wakeAgents = async (agents: readonly SessionId[], context: ToolWakeContext) =>
    awaitResult(
      await host.status(agents),
      context.aborted
        ? "cancelled"
        : context.expired
          ? "timeout"
          : isJsonObject(context.reply) && context.reply.kind === "yield"
            ? "yield"
            : "settled",
    );
  const settle = <Details>(outcome: WaitOutcome<Details>): AgentToolResult<Details> => {
    if (outcome.isError) throw new ToolError(outcome.result);
    return outcome.result;
  };
  const forAgent = (
    outcome: WaitOutcome<AwaitDetails>,
    agent: SessionId,
  ): WaitOutcome<AgentDetails & AwaitDetails> => ({
    isError: outcome.isError,
    result: { ...outcome.result, details: { agent, ...outcome.result.details } },
  });

  const task: AgentTool<typeof taskParameters, AgentDetails & AwaitDetails> = {
    name: TASK_TOOL,
    description: `Creates an agent in a fresh session, sends it the prompt, and waits up to waitMs (default ${DEFAULT_TASK_WAIT_MS} ms) for its report. Defaults to ${DEFAULT_TASK_MODEL} with ${DEFAULT_TASK_THINKING_LEVEL} thinking unless the user requests another model or thinking level.
Returns the report when the agent finishes in time; otherwise returns the agent's id and phase, and the agent keeps working. Its report then arrives on its own as a "Background" message, or call await with the id when you need it before you reply. The agent persists until you call stop: send it follow-up messages, read its transcript, or stop it.
If the user sends something while you wait, this returns early so you can answer them. Never poll, sleep, or relaunch a task to check progress.`,
    parameters: taskParameters,
    replay: "never",
    present: presentChild,
    prepareArguments(value) {
      if (!Value.Check(taskParameters, value)) {
        throw new Error(
          "Task arguments are invalid. Provide a nonempty prompt. If set, model must be an exact provider/model; only title, model, thinkingLevel, and waitMs are optional.",
        );
      }
      return value;
    },
    async execute(callId, input, signal, _onUpdate, context) {
      if (context === undefined) throw new Error("Task execution requires a run context");
      const title = taskTitle(input);
      const agent = await host.create({
        title,
        model: input.model ?? DEFAULT_TASK_MODEL,
        thinkingLevel: input.thinkingLevel ?? DEFAULT_TASK_THINKING_LEVEL,
        runId: context.runId,
        callId,
        head: context.head,
        signal,
      });
      const sent = await host.send({
        agent,
        message: input.prompt,
        runId: context.runId,
        callId,
        head: context.head,
      });
      if (sent.kind === "not_found") throw new Error(`Agent ${agent} was not created`);
      return settle(
        forAgent(
          await awaitAgents([agent], "all", input.waitMs ?? DEFAULT_TASK_WAIT_MS, context.head),
          agent,
        ),
      );
    },
    wake: async (call, context) => {
      const agent = host.childOf(call.head, call.runId, call.toolCallId);
      return { kind: "settle", ...forAgent(await wakeAgents([agent], context), agent) };
    },
  };

  const create: AgentTool<typeof createParameters, AgentDetails> = {
    name: "create",
    description: `Creates a persistent agent in a fresh session and returns its id at once, without sending it anything. Defaults to ${DEFAULT_TASK_MODEL} with ${DEFAULT_TASK_THINKING_LEVEL} thinking. Use send to give it work, await or read to follow it, and stop when you are done with it; it persists until stop.`,
    parameters: createParameters,
    replay: "never",
    present: presentChild,
    prepareArguments(value) {
      if (!Value.Check(createParameters, value)) {
        throw new Error(
          "Create arguments are invalid. Provide a nonempty title. If set, model must be an exact provider/model; only model, thinkingLevel, and system are optional.",
        );
      }
      return value;
    },
    async execute(callId, input, signal, _onUpdate, context) {
      if (context === undefined) throw new Error("Create execution requires a run context");
      const agent = await host.create({
        title: input.title,
        model: input.model ?? DEFAULT_TASK_MODEL,
        thinkingLevel: input.thinkingLevel ?? DEFAULT_TASK_THINKING_LEVEL,
        ...(input.system === undefined ? {} : { system: input.system }),
        runId: context.runId,
        callId,
        head: context.head,
        signal,
      });
      return {
        content: toolResultContent(
          `Created agent ${input.title} as ${agent}. Send it a message to start it.`,
        ),
        details: { agent },
        title: input.title,
      };
    },
  };

  const send: AgentTool<typeof sendParameters, AgentDetails & AwaitDetails> = {
    name: "send",
    description: `Sends a message to an agent this session created. The agent answers in its own session, with its earlier turns as context; its report arrives as a "Background" message once it finishes. Set waitMs to wait for the answer here, up to that long; without it this returns a receipt at once. If the user sends something while you wait, this returns early so you can answer them.`,
    parameters: sendParameters,
    replay: "never",
    present: (input) => ({
      kind: "delegate",
      role: "send",
      target: { kind: "one", session: input.agent },
    }),
    prepareArguments(value) {
      if (!Value.Check(sendParameters, value)) {
        throw new Error(
          "Send arguments are invalid. Provide an agent id and a nonempty message; waitMs is optional.",
        );
      }
      return value;
    },
    async execute(callId, input, _signal, _onUpdate, context) {
      if (context === undefined) throw new Error("Send execution requires a run context");
      const sent = await host.send({
        agent: input.agent,
        message: input.message,
        runId: context.runId,
        callId,
        head: context.head,
      });
      if (sent.kind === "not_found") {
        throw new ToolError({
          content: toolResultContent(`No agent ${input.agent} belongs to this session.`),
          details: { agent: input.agent, agents: [] },
        });
      }
      if (sent.kind === "stopped") {
        throw new ToolError({
          content: toolResultContent(
            `Agent ${sent.title} (${input.agent}) was stopped and answers no further messages.`,
          ),
          details: { agent: input.agent, agents: [] },
        });
      }
      if (input.waitMs === undefined) {
        return {
          content: toolResultContent(
            `Sent to agent ${sent.title} (${input.agent}). Its report arrives as a "Background" message; call await with its id if you need it before you reply.`,
          ),
          details: { agent: input.agent, agents: [] },
          title: sent.title,
        };
      }
      return settle(
        forAgent(await awaitAgents([input.agent], "all", input.waitMs, context.head), input.agent),
      );
    },
    wake: async (call, context) => {
      if (!Value.Check(sendParameters, call.args)) throw new Error("Send arguments are invalid");
      const { agent } = call.args;
      return { kind: "settle", ...forAgent(await wakeAgents([agent], context), agent) };
    },
  };

  const awaitTool: AgentTool<typeof awaitParameters, AwaitDetails> = {
    name: "await",
    description: `Waits for agents this session created: until any or all of them have answered their latest message, or until timeoutMs passes. Returns each agent's report where it has one and its phase otherwise; the agents keep working either way, so call await again when you need them. Reports also arrive on their own as "Background" messages. If the user sends something while you wait, this returns early so you can answer them.`,
    parameters: awaitParameters,
    replay: "never",
    present: (input) => {
      const [first, ...rest] = input.agents;
      if (first === undefined) throw new Error("Await names no agent");
      return {
        kind: "delegate",
        role: "await",
        target: { kind: "many", sessions: [first, ...rest], mode: input.mode },
      };
    },
    prepareArguments(value) {
      if (!Value.Check(awaitParameters, value)) {
        throw new Error(
          "Await arguments are invalid. Provide at least one agent id, mode any or all, and timeoutMs.",
        );
      }
      return value;
    },
    async execute(_callId, input, _signal, _onUpdate, context) {
      if (context === undefined) throw new Error("Await execution requires a run context");
      return settle(await awaitAgents(input.agents, input.mode, input.timeoutMs, context.head));
    },
    wake: async (call, context) => {
      if (!Value.Check(awaitParameters, call.args)) throw new Error("Await arguments are invalid");
      const outcome = await wakeAgents(call.args.agents, context);
      return { kind: "settle", result: outcome.result, isError: outcome.isError };
    },
  };

  const read: AgentTool<typeof readParameters, AgentDetails & { readonly phase: AgentPhase }> = {
    name: "read",
    description: `Reads an agent's latest turns (default ${DEFAULT_READ_TURNS}) and its phase, without waiting. Use it to check on an agent that is still working or to revisit what it said.`,
    parameters: readParameters,
    replay: "safe",
    present: (input) => ({
      kind: "delegate",
      role: "read",
      target: { kind: "one", session: input.agent },
    }),
    prepareArguments(value) {
      if (!Value.Check(readParameters, value)) {
        throw new Error("Read arguments are invalid. Provide an agent id; turns is optional.");
      }
      return value;
    },
    async execute(_callId, input) {
      const outcome = await host.read({
        agent: input.agent,
        turns: input.turns ?? DEFAULT_READ_TURNS,
      });
      if (outcome.kind === "not_found") {
        throw new ToolError({
          content: toolResultContent(`No agent ${input.agent} belongs to this session.`),
          details: { agent: input.agent, phase: "idle" },
        });
      }
      return {
        content: toolResultContent(
          `Agent ${outcome.title} (${input.agent}) is ${outcome.phase}.\n\n${outcome.text === "" ? "(no turns yet)" : outcome.text}`,
        ),
        details: { agent: input.agent, phase: outcome.phase },
        title: outcome.title,
      };
    },
  };

  const stop: AgentTool<typeof stopParameters, AgentDetails> = {
    name: "stop",
    description:
      "Stops an agent this session created: cancels its running work and everything queued for it. The agent answers no further messages. Stopping an agent does not stop this run.",
    parameters: stopParameters,
    replay: "never",
    present: (input) => ({
      kind: "delegate",
      role: "stop",
      target: { kind: "one", session: input.agent },
    }),
    prepareArguments(value) {
      if (!Value.Check(stopParameters, value)) {
        throw new Error("Stop arguments are invalid. Provide an agent id.");
      }
      return value;
    },
    async execute(_callId, input, signal) {
      signal?.throwIfAborted();
      const outcome = await host.stop(input.agent);
      if (outcome.kind === "not_found") {
        throw new ToolError({
          content: toolResultContent(`No agent ${input.agent} belongs to this session.`),
          details: { agent: input.agent },
        });
      }
      return {
        content: toolResultContent(`Agent ${outcome.title} (${input.agent}) stopped.`),
        details: { agent: input.agent },
        title: outcome.title,
      };
    },
  };

  return definePlugin({
    id: SUBAGENTS_PLUGIN_ID,
    session(api) {
      api.tools.add((draft) => {
        draft.set(task.name, task);
        draft.set(create.name, create);
        draft.set(send.name, send);
        draft.set(awaitTool.name, awaitTool);
        draft.set(read.name, read);
        draft.set(stop.name, stop);
      });
    },
  });
}
