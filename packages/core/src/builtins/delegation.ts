import { Type } from "typebox";
import { asId, standard } from "@nyte-ai/schema";
import type {
  ConfigurationPatch,
  Infer,
  Message,
  ModelRef,
  RunEnd,
  RunId,
  ToolResult,
  WaitOutcome,
} from "@nyte-ai/schema";
import { isPart, text, tool } from "../contract/parts.ts";
import type { Plugin } from "../contract/plugin.ts";
import type { SendReceipt, Session } from "../contract/session.ts";
import type { ToolDefinition, ToolInvocation } from "../contract/tools.ts";
import { extractUserText } from "../util/text.ts";
import { followedTrace, traceReceipt } from "../util/trace.ts";

const ANSWER_LIMIT = 16_000;

const TRANSCRIPT_LIMIT = 16_000;

const selectionParameters = {
  agent: Type.Optional(
    Type.String({ description: "A registered agent to run as; the default agent otherwise." }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "A model from /model, as provider/id or its id alone; a fast variant is its own id. The default model otherwise.",
    }),
  ),
  thinking: Type.Optional(
    Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"], {
      description: "A thinking level the model accepts; its default otherwise.",
    }),
  ),
};

const isolationParameter = {
  isolation: Type.Optional(
    Type.Literal("worktree", {
      description:
        "Run the subagent in a git worktree on a new branch from HEAD, with your uncommitted changes copied in, so its edits stay out of this workspace. The reply names the folder and branch. Without it, the subagent works in this workspace.",
    }),
  ),
};

const taskParameters = standard(
  Type.Object({
    prompt: Type.String({
      description: "The task for the subagent, with everything it needs to know.",
    }),
    title: Type.Optional(Type.String({ description: "A short name for the subagent's session." })),
    ...selectionParameters,
    ...isolationParameter,
  }),
);

const createParameters = standard(
  Type.Object({
    prompt: Type.String({
      description: "The subagent's first message; it starts working on it at once.",
    }),
    title: Type.Optional(Type.String({ description: "A short name for the subagent's session." })),
    ...selectionParameters,
    ...isolationParameter,
    role: Type.Optional(
      Type.String({
        description: "Instructions the subagent keeps for every message, added to its prompt.",
      }),
    ),
  }),
);

const sendParameters = standard(
  Type.Object({
    session: Type.String({ description: "The subagent's session id, from task or create." }),
    prompt: Type.String({ description: "The message for the subagent." }),
  }),
);

const awaitParameters = standard(
  Type.Object({
    session: Type.String({ description: "The subagent's session id, from task or create." }),
    timeout: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Seconds to wait before returning while it still works.",
      }),
    ),
  }),
);

const readParameters = standard(
  Type.Object({
    session: Type.String({ description: "The subagent's session id, from task or create." }),
  }),
);

const stopParameters = standard(
  Type.Object({
    session: Type.String({ description: "The subagent's session id, from task or create." }),
  }),
);

const task: ToolDefinition<Infer<typeof taskParameters>> = {
  name: "task",
  description:
    "Run a subagent on a task and wait for its answer. Give it everything it needs; it does not see this conversation.",
  parameters: taskParameters,
  class: (args) => ({ kind: "delegate", child: null, role: "task", title: args.title ?? null }),
  replay: "safe",
  async execute(args, invocation) {
    const { session: child, receipt } = await invocation.sdk.sessions.start({
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
    const answer = await readSubagentReply(child, run, outcome);
    const worktree = await describeWorktree(invocation, child);

    return reply(worktree === null ? answer : `${worktree}\n\n${answer}`);
  },
};

const create: ToolDefinition<Infer<typeof createParameters>> = {
  name: "create",
  description:
    "Start a subagent on a first message and return its id, to send it more messages and await it later.",
  parameters: createParameters,
  class: (args) => ({ kind: "delegate", child: null, role: "create", title: args.title ?? null }),
  effects: "none",
  replay: "safe",
  async execute(args, invocation) {
    const { session: child } = await invocation.sdk.sessions.start({
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
  description:
    "Send a message to a subagent; it works in the background. Use await for its answer.",
  parameters: sendParameters,
  class: (args) => ({
    kind: "delegate",
    child: asId<"session">(args.session),
    role: "send",
    title: null,
  }),
  effects: "none",
  replay: "safe",
  async execute(args, invocation) {
    const child = await requireChildSession(invocation, args.session);
    const receipt = await sendOnce(invocation, child, args.prompt);
    const view = await child.view();
    const message = view.messages.find((entry) => entry.id === receipt.message);

    return reply(`Sent to subagent ${child.id}; ${scheduled(message)}.`);
  },
};

const awaitChild: ToolDefinition<Infer<typeof awaitParameters>> = {
  name: "await",
  description: "Wait for a subagent to finish its current work and return its answer.",
  parameters: awaitParameters,
  class: (args) => ({
    kind: "delegate",
    child: asId<"session">(args.session),
    role: "await",
    title: null,
  }),
  replay: "safe",
  async execute(args, invocation) {
    const child = await requireChildSession(invocation, args.session);
    const run = await invocation.memo("run", async () => {
      const { execution } = await child.view();

      return execution.kind === "idle" ? null : execution.run.id;
    });

    if (run === null) {
      const execution = (await child.view()).execution;
      const last = execution.kind === "idle" ? execution.lastRun : null;

      if (last === null) return reply(`Subagent ${child.id} has not worked on anything yet.`);

      return reply(
        await readSubagentReply(child, last.id, {
          kind: "run",
          session: child.id,
          run: last.id,
          end: last.end,
        }),
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

    return reply(await readSubagentReply(child, run, outcome));
  },
};

const readAgent: ToolDefinition<Infer<typeof readParameters>> = {
  name: "read_agent",
  description: "Read a subagent's conversation so far, newest last.",
  parameters: readParameters,
  class: (args) => ({
    kind: "delegate",
    child: asId<"session">(args.session),
    role: "read",
    title: null,
  }),
  effects: "none",
  replay: "safe",
  async execute(args, invocation) {
    const child = await requireChildSession(invocation, args.session);
    const view = await child.view();
    const execution = view.execution.kind;

    const state = execution === "idle" ? "idle" : execution === "waiting" ? "waiting" : "working";

    const transcript = fromEnd(
      view.messages.flatMap(renderTranscriptMessage).join("\n\n"),
      TRANSCRIPT_LIMIT,
    );

    return reply(
      transcript === ""
        ? `Subagent ${child.id} is ${state} and has no messages yet.`
        : `Subagent ${child.id} is ${state}.\n\n${transcript}`,
    );
  },
};

const stop: ToolDefinition<Infer<typeof stopParameters>> = {
  name: "stop",
  description: "Stop a subagent's current work.",
  parameters: stopParameters,
  class: (args) => ({
    kind: "delegate",
    child: asId<"session">(args.session),
    role: "stop",
    title: null,
  }),
  effects: "none",
  replay: "safe",
  async execute(args, invocation) {
    const child = await requireChildSession(invocation, args.session);
    const { stopped, withdrawn } = await child.stop();

    return reply(
      `Stopped ${stopped.length} run${stopped.length === 1 ? "" : "s"} of subagent ${child.id} and withdrew ${withdrawn.length} pending message${withdrawn.length === 1 ? "" : "s"}.`,
    );
  },
};

export const delegationPlugin: Plugin<"core"> = {
  id: "delegation",
  async activate(api) {
    if ((await api.session.info()).parent !== null) return;

    for (const tool of [task, create, send, awaitChild, readAgent, stop])
      api.contribute.tools.add(tool);
  },
};

async function childConfiguration(
  invocation: ToolInvocation,
  { agent, model, thinking }: Pick<Infer<typeof taskParameters>, "agent" | "model" | "thinking">,
): Promise<ConfigurationPatch | undefined> {
  if (agent === undefined && model === undefined && thinking === undefined) return undefined;

  return {
    agent,
    model: model === undefined ? undefined : await findModel(invocation, model),
    thinking,
  };
}

async function findModel(invocation: ToolInvocation, name: string): Promise<ModelRef> {
  const models = (await invocation.sdk.models.list()).providers.flatMap((provider) =>
    provider.credential === "unknown" ||
    provider.credential === "configured" ||
    provider.credential === "verified"
      ? provider.models
      : [],
  );

  const refs = models.flatMap((info) => (info.fast === null ? [info.ref] : [info.ref, info.fast]));
  const exact = refs.filter((ref) => `${ref.provider}/${ref.id}` === name);
  const matches = exact.length > 0 ? exact : refs.filter((ref) => ref.id === name);
  const [only, ...others] = matches;

  if (only !== undefined && others.length === 0) return only;

  if (only !== undefined)
    throw new Error(
      `${name} names more than one model; pass one of ${matches.map((ref) => `${ref.provider}/${ref.id}`).join(", ")}.`,
    );

  if (models.length === 0) throw new Error("No model is available; sign in to a provider first.");

  throw new Error(
    `/model has no ${name}. Choose one of:\n${models
      .map(
        (info) =>
          `- ${info.ref.provider}/${info.ref.id} (thinking: ${info.thinking.join(", ")})${info.fast === null ? "" : `, fast: ${info.fast.provider}/${info.fast.id}`}`,
      )
      .join("\n")}`,
  );
}

/** The worktree a subagent works in, as a sentence for the model, or null when it shares this workspace. */
async function describeWorktree(
  invocation: ToolInvocation,
  child: Session,
): Promise<string | null> {
  const workspace = await invocation.sdk.workspace((await child.info()).workspace).info();

  if (workspace.isolation === null) return null;
  const folder = "path" in workspace.target ? workspace.target.path : workspace.id;

  return `It works in the worktree ${folder} on branch ${workspace.isolation.branch}.`;
}

function reply(content: string): ToolResult<unknown> {
  return { content: [{ kind: "text", text: content }] };
}

async function requireChildSession(invocation: ToolInvocation, id: string): Promise<Session> {
  const child = invocation.sdk.session(asId<"session">(id));

  if ((await child.info()).parent !== invocation.session.id)
    throw new Error(`Session ${id} is not a subagent of this session.`);

  return child;
}

function sendOnce(
  invocation: ToolInvocation,
  child: Session,
  prompt: string,
): Promise<SendReceipt> {
  const id = asId<"receipt">(`${invocation.call}:${child.id}`);
  traceReceipt(id, followedTrace(invocation.session.id));

  return child.send(prompt, { id });
}

async function readSubagentReply(
  child: Session,
  run: RunId,
  outcome: WaitOutcome,
): Promise<string> {
  const header = `Subagent ${child.id} ${describeSubagentOutcome(outcome)}.`;
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

  return answer === "" ? header : `${header}\n\n${fromStart(answer, ANSWER_LIMIT)}`;
}

function describeSubagentOutcome(outcome: WaitOutcome): string {
  if (outcome.kind === "run") return endedAs(outcome.end);

  return outcome.kind === "stopped"
    ? "is still working; this call was stopped before it ended"
    : "is still working";
}

function endedAs(end: RunEnd): string {
  switch (end.kind) {
    case "completed":
      return "finished";
    case "stopped":
      return "was stopped";
    case "failed":
      return `failed: ${end.failure.message}`;
  }
}

function scheduled(message: Message | undefined): string {
  if (message?.kind !== "user") return "it was admitted";

  if (message.status.kind === "landed") return "it started working on it";

  if (message.status.kind !== "pending") return "it was admitted";

  switch (message.status.schedule.kind) {
    case "joined":
      return "it joins the work in progress";
    case "next-turn":
      return "it runs once its current work ends";
    case "attached":
      return "it rides with its next turn";
    case "deciding":
      return "its plugins are deciding it";
  }
}

function renderTranscriptMessage(message: Message): readonly string[] {
  if (message.kind === "user") return [`User: ${extractUserText(message.content)}`];

  if (isPart(message, text))
    return message.state.markdown === "" ? [] : [`Assistant: ${message.state.markdown}`];

  if (isPart(message, tool)) {
    const state = message.state;
    const status = state.phase === "settled" ? state.outcome.kind : state.phase;

    return [`Tool ${state.name}(${JSON.stringify(state.args)}): ${status}`];
  }

  return [];
}

function fromStart(content: string, limit: number): string {
  return content.length > limit
    ? `${content.slice(0, limit)}\n\n[… cut at ${limit} characters]`
    : content;
}

function fromEnd(content: string, limit: number): string {
  return content.length > limit ? `[… earlier messages cut]\n\n${content.slice(-limit)}` : content;
}
