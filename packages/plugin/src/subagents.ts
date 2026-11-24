import { Type } from "typebox";
import { asId, enabledModels, matchModels, standard } from "@nyte-ai/schema";
import type {
  ConfigurationPatch,
  Infer,
  Message,
  ModelRef,
  RunEnd,
  RunId,
  Schedule,
  ToolResult,
  WaitOutcome,
} from "@nyte-ai/schema";
import { clipText, isPart, text, tool } from "@nyte-ai/core";
import type { Session, ToolDefinition, ToolInvocation, When } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/plugin/core";

const CAPITALIZED = { subagent: "Subagent", chat: "Chat" } as const;

const SCHEDULED: Readonly<Record<Schedule["kind"], string>> = {
  joined: "it joins the work in progress",
  "next-turn": "it runs once its current work ends",
  attached: "it rides with its next turn",
  deciding: "its plugins are deciding it",
};

const selectionParameters = {
  agent: Type.Optional(
    Type.String({
      description:
        "A registered agent to run as, only when the user names one. The system prompt lists them.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "A model to run on, only when the user asks for one: an enabled model the system prompt lists, as provider/id.",
    }),
  ),
  thinking: Type.Optional(
    Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"], {
      description: "A thinking level, only when the user asks for one.",
    }),
  ),
};

const isolationParameter = {
  isolation: Type.Optional(
    Type.Literal("worktree", {
      description:
        "Only when the user asks for an isolated copy: a git worktree on a new branch from HEAD, with your uncommitted changes copied in.",
    }),
  ),
};

const taskParameters = standard(
  Type.Object({
    prompt: Type.String({
      description:
        "The task for the subagent, with everything it needs to know. Only its last message comes back, so say what that message should report.",
    }),
    title: Type.Optional(Type.String({ description: "A short name." })),
    ...selectionParameters,
    ...isolationParameter,
  }),
);

const createParameters = standard(
  Type.Object({
    prompt: Type.String({
      description:
        "The subagent's first message; it starts working on it at once. Only its last message comes back, so say what that message should report.",
    }),
    title: Type.Optional(Type.String({ description: "A short name." })),
    ...selectionParameters,
    ...isolationParameter,
    role: Type.Optional(
      Type.String({
        description: "Instructions it keeps for every message.",
      }),
    ),
  }),
);

const sessionField = Type.String({
  description: "Id from `task`, `create`, `thread_start` or `thread_list`.",
});

const sendParameters = standard(
  Type.Object({
    session: sessionField,
    prompt: Type.String(),
  }),
);

const awaitParameters = standard(
  Type.Object({
    session: sessionField,
    timeout: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Seconds. A timeout doesn't stop it.",
      }),
    ),
  }),
);

const readParameters = standard(
  Type.Object({
    session: sessionField,
  }),
);

const stopParameters = standard(
  Type.Object({
    session: sessionField,
  }),
);

const task: ToolDefinition<Infer<typeof taskParameters>> = {
  name: "task",
  description:
    "Run a subagent and get its answer as this call's result, whenever you need the answer this turn. Several task calls in one response run in parallel. It does not see this conversation.",
  parameters: taskParameters,
  class: (args) => ({ kind: "delegate", child: null, role: "task", title: args.title ?? null }),
  rerun: "safe",
  async execute(args, invocation) {
    const { session: child, receipt } = await invocation.host.sessions.start({
      parent: invocation.session.id,
      name: args.title,
      configuration: await childConfiguration(invocation, args),
      isolation: args.isolation,
      content: args.prompt,
    });

    const run = await invocation.memo("run", async () => {
      const landing = await receipt.landed();

      return landing.kind === "landed" ? landing.run : null;
    });

    if (run === null) return reply(`Subagent ${child.id} did not start the task.`);
    const outcome = await invocation.wait({
      kind: "any",
      targets: [{ kind: "run", session: child.id, run }],
      untilInput: true,
    });
    const answer = await readSubagentReply({ session: child, noun: "subagent" }, run, outcome);
    const worktree = await describeWorktree(invocation, child);

    return reply(clipText(worktree === null ? answer : `${worktree}\n\n${answer}`, "head"));
  },
};

const create: ToolDefinition<Infer<typeof createParameters>> = {
  name: "create",
  description:
    "Start a subagent in the background and return its id, for work you won't wait on or a subagent you'll message again with send. Its answer reaches you on its own. When you need the answer this turn, use task instead. Link it in a reply as [short title](agent:<id>).",
  parameters: createParameters,
  class: (args) => ({ kind: "delegate", child: null, role: "create", title: args.title ?? null }),
  changes: "none",
  rerun: "safe",
  async execute(args, invocation) {
    const { session: child } = await invocation.host.sessions.start({
      parent: invocation.session.id,
      name: args.title,
      configuration: await childConfiguration(invocation, args),
      prompt: args.role === undefined ? undefined : { kind: "layer", text: args.role },
      isolation: args.isolation,
      content: args.prompt,
    });
    const worktree = await describeWorktree(invocation, child);

    return reply(
      worktree === null
        ? `Started subagent ${child.id}.`
        : `Started subagent ${child.id}. ${worktree}`,
    );
  },
};

const send: ToolDefinition<Infer<typeof sendParameters>> = {
  name: "send",
  description: "Send to a subagent or any chat. It queues behind current work. Answer: `await`.",
  parameters: sendParameters,
  class: (args) => ({
    kind: "delegate",
    child: asId<"session">(args.session),
    role: "send",
    title: null,
  }),
  changes: "none",
  rerun: "safe",
  async execute(args, invocation) {
    const target = await findTarget(invocation, args.session, "steer");
    const child = target.session;
    const receipt = await child.send(args.prompt, {
      id: asId<"receipt">(`${invocation.call}:${child.id}`),
    });
    const view = await child.view();
    const message = [...view.messages, ...view.queue].find((entry) => entry.id === receipt.message);

    return reply(`Sent to ${target.noun} ${child.id}; ${scheduled(message)}.`);
  },
};

const awaitChild: ToolDefinition<Infer<typeof awaitParameters>> = {
  name: "await",
  description:
    "Wait for a subagent or chat to finish its current work, and get its answer. Idle: its last answer, at once.",
  parameters: awaitParameters,
  class: (args) => ({
    kind: "delegate",
    child: asId<"session">(args.session),
    role: "await",
    title: null,
  }),
  rerun: "safe",
  async execute(args, invocation) {
    const target = await findTarget(invocation, args.session, "read");
    const child = target.session;
    const run = await invocation.memo("run", async () => {
      const { execution } = await child.view();

      return execution.kind === "idle" ? null : execution.run.id;
    });

    if (run === null) {
      const execution = (await child.view()).execution;
      const last = execution.kind === "idle" ? execution.lastRun : null;

      if (last === null) {
        return reply(`${CAPITALIZED[target.noun]} ${child.id} has not worked on anything yet.`);
      }

      return reply(
        clipText(
          await readSubagentReply(target, last.id, {
            kind: "run",
            session: child.id,
            run: last.id,
            end: last.end,
          }),
          "head",
        ),
      );
    }

    const targets = [{ kind: "run", session: child.id, run }] as const;

    const outcome = await invocation.wait(
      args.timeout === undefined
        ? { kind: "any", targets, untilInput: true }
        : {
            kind: "any",
            targets,
            untilInput: true,
            deadline: invocation.now() + args.timeout * 1000,
          },
    );

    return reply(clipText(await readSubagentReply(target, run, outcome), "head"));
  },
};

const readAgent: ToolDefinition<Infer<typeof readParameters>> = {
  name: "read_agent",
  description: "Read a subagent's or chat's transcript, newest last.",
  parameters: readParameters,
  class: (args) => ({
    kind: "delegate",
    child: asId<"session">(args.session),
    role: "read",
    title: null,
  }),
  changes: "none",
  rerun: "safe",
  async execute(args, invocation) {
    const target = await findTarget(invocation, args.session, "read");
    const child = target.session;
    const view = await child.view();
    const execution = view.execution.kind;

    const state = execution === "idle" ? "idle" : execution === "waiting" ? "waiting" : "working";

    const transcript = [...view.messages, ...view.queue]
      .flatMap(renderTranscriptMessage)
      .join("\n\n");

    return reply(
      transcript === ""
        ? `${CAPITALIZED[target.noun]} ${child.id} is ${state} and has no messages yet.`
        : clipText(`${transcript}\n\n${CAPITALIZED[target.noun]} ${child.id} is ${state}.`, "tail"),
    );
  },
};

const stop: ToolDefinition<Infer<typeof stopParameters>> = {
  name: "stop",
  description: "Stop a subagent's or chat's work and drop its queued messages.",
  parameters: stopParameters,
  class: (args) => ({
    kind: "delegate",
    child: asId<"session">(args.session),
    role: "stop",
    title: null,
  }),
  changes: "none",
  rerun: "safe",
  async execute(args, invocation) {
    const target = await findTarget(invocation, args.session, "steer");
    const child = target.session;
    const { stopped, withdrawn } = await child.stop();

    return reply(
      `Stopped ${stopped.length} run${stopped.length === 1 ? "" : "s"} of ${target.noun} ${child.id} and withdrew ${withdrawn.length} pending message${withdrawn.length === 1 ? "" : "s"}.`,
    );
  },
};

const topLevel: When = (chat) => chat.parent === null;

export default {
  id: "subagents",
  contribute: {
    tools: [task, create, send, awaitChild, readAgent, stop].map((definition) => ({
      ...definition,
      when: topLevel,
    })),
    prompt: [
      {
        id: "subagents",
        order: 97,
        when: topLevel,
        text: async (context) => {
          const models = enabledModels(await context.api.host.models.list());
          const agents = context.api.registries.agents.list();

          return [
            `Enabled models, for the model of task and create: ${models.length === 0 ? "none" : models.map((info) => `${info.ref.provider}/${info.ref.id}`).join(", ")}.`,
            ...(agents.length === 0
              ? []
              : [
                  `Registered agents, for their agent: ${agents.map((agent) => agent.id).join(", ")}.`,
                ]),
          ].join("\n");
        },
      },
    ],
  },
} satisfies Plugin;

async function childConfiguration(
  invocation: ToolInvocation,
  args: Pick<Infer<typeof taskParameters>, "agent" | "model" | "thinking">,
): Promise<ConfigurationPatch | undefined> {
  const view = await invocation.session.head(invocation.head).view({ tail: 0 });

  const unregistered =
    args.agent !== undefined && !view.catalog.agents.some((agent) => agent.id === args.agent)
      ? args.agent
      : undefined;

  const agent = unregistered === undefined ? args.agent : undefined;
  const effective = view.configuration.effective;
  const parent = agent === undefined && effective?.agent !== null ? effective : null;

  const named =
    unregistered === undefined
      ? args.model === undefined
        ? undefined
        : await findModel(invocation, args.model)
      : await findAgentModel(invocation, unregistered, args.model);

  const patch = {
    agent: agent ?? parent?.agent,
    model: named ?? parent?.model,
    thinking: args.thinking ?? (named === undefined ? parent?.thinking : undefined),
  };

  return Object.values(patch).every((value) => value === undefined) ? undefined : patch;
}

async function findModel(invocation: ToolInvocation, name: string): Promise<ModelRef> {
  const models = enabledModels(await invocation.host.models.list());
  const matches = matchModels(models, name);
  const [only, ...others] = matches;

  if (only !== undefined && others.length === 0) return only;

  if (only !== undefined) {
    throw new Error(
      `${name} names more than one model; pass one of ${matches.map((ref) => `${ref.provider}/${ref.id}`).join(", ")}.`,
    );
  }

  if (models.length === 0) throw new Error("No model is available; sign in to a provider first.");

  throw new Error(
    `/model has no ${name}. Choose one of:\n${models
      .map(
        (info) =>
          `- ${info.ref.provider}/${info.ref.id} (thinking: ${info.thinking.join(", ")})${info.variants.map((variant) => `, ${variant.modes.join(" + ")}: ${variant.ref.provider}/${variant.ref.id}`).join("")}`,
      )
      .join("\n")}`,
  );
}

async function findAgentModel(
  invocation: ToolInvocation,
  agent: string,
  model: string | undefined,
): Promise<ModelRef> {
  const models = enabledModels(await invocation.host.models.list());
  const names = model === undefined ? [agent] : [model, `${agent} ${model}`, agent];

  const [found] = names.flatMap((name) => {
    const matches = matchModels(models, name);

    return matches.length === 1 ? matches : [];
  });

  if (found === undefined) throw new Error(`No agent is registered as ${agent}.`);

  return found;
}

async function describeWorktree(
  invocation: ToolInvocation,
  child: Session,
): Promise<string | null> {
  const workspace = await invocation.host.workspace((await child.info()).workspace).info();

  if (workspace.isolation === null) return null;
  const folder = "path" in workspace.target ? workspace.target.path : workspace.id;

  return `It works in the worktree ${folder} on branch ${workspace.isolation.branch}.`;
}

interface Target {
  readonly session: Session;
  readonly noun: keyof typeof CAPITALIZED;
}

function reply(content: string): ToolResult<unknown> {
  return { content: [{ kind: "text", text: content }] };
}

async function findTarget(
  invocation: ToolInvocation,
  id: string,
  access: "read" | "steer",
): Promise<Target> {
  const session = invocation.host.session(asId<"session">(id));

  if (session.id === invocation.session.id) throw new Error("That is this chat.");
  const info = await session.info();
  const grant = (await invocation.session.info()).mcp?.grant;

  if (access === "steer" && grant !== undefined && info.mcp?.grant !== grant) {
    throw new Error(
      `Chat ${id} wasn't started through this chat's MCP grant, so this chat may not message or stop it.`,
    );
  }

  return { session, noun: info.parent === invocation.session.id ? "subagent" : "chat" };
}

async function readSubagentReply(
  target: Target,
  run: RunId,
  outcome: WaitOutcome,
): Promise<string> {
  const child = target.session;
  const header = `${CAPITALIZED[target.noun]} ${child.id} ${describeSubagentOutcome(outcome)}.`;
  const view = await child.view();
  const turn = view.turns.find((entry) => entry.run === run)?.id;

  const answer =
    view.messages
      .flatMap((message) =>
        message.turn === turn && isPart(message, text) && message.state.markdown !== ""
          ? [message.state.markdown]
          : [],
      )
      .at(-1) ?? "";

  return answer === "" ? header : `${header}\n\n${answer}`;
}

function describeSubagentOutcome(outcome: WaitOutcome): string {
  if (outcome.kind === "run") return endedAs(outcome.end);

  return outcome.kind === "stopped"
    ? "is still working; this call was stopped before it ended"
    : "is still working";
}

function endedAs(end: RunEnd): string {
  if (end.kind === "failed") return `failed: ${end.failure.message}`;

  return end.kind === "completed" ? "finished" : "was stopped";
}

function scheduled(message: Message | undefined): string {
  if (message?.kind !== "user") return "it was admitted";

  if (message.status.kind === "landed") return "it started working on it";

  if (message.status.kind !== "pending") return "it was admitted";

  return SCHEDULED[message.status.schedule.kind];
}

function renderTranscriptMessage(message: Message): readonly string[] {
  if (message.kind === "user") {
    return [
      `User: ${typeof message.content === "string" ? message.content : message.content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join(" ")}`,
    ];
  }

  if (isPart(message, text)) {
    return message.state.markdown === "" ? [] : [`Assistant: ${message.state.markdown}`];
  }

  if (isPart(message, tool)) {
    const state = message.state;
    const status = state.phase === "settled" ? state.outcome.kind : state.phase;

    return [`Tool ${state.name}(${JSON.stringify(state.args)}): ${status}`];
  }

  return [];
}
