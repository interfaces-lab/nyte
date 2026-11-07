import { Type } from "typebox";
import { asId, standard } from "@nyte-ai/schema";
import type {
  ConfigurationPatch,
  Infer,
  Message,
  ModelInfo,
  ModelRef,
  RunEnd,
  RunId,
  Schedule,
  ToolResult,
  WaitOutcome,
} from "@nyte-ai/schema";
import { clipText, isPart, text, tool } from "@nyte-ai/core";
import type { Session, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/plugin/core";

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
        "A registered agent to run as, only when the user names one. Without it, a chat that runs as an agent starts subagents of its own agent, model and thinking level; any other chat, of the default agent.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "A model to run on, only when the user asks for one: provider/id or an id from /model. Without it, the subagent runs on the inherited or default model.",
    }),
  ),
  thinking: Type.Optional(
    Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"], {
      description:
        "A thinking level, only when the user asks for one; the model must accept it. The inherited level or the model's default otherwise.",
    }),
  ),
};

const isolationParameter = {
  isolation: Type.Optional(
    Type.Literal("worktree", {
      description:
        "Only when the user asks for an isolated copy: runs the subagent in a git worktree on a new branch from HEAD, with your uncommitted changes copied in. The reply names the folder and branch. Without it, the subagent works in this workspace.",
    }),
  ),
};

const taskParameters = standard(
  Type.Object({
    prompt: Type.String({
      description:
        "The task for the subagent, with everything it needs to know. Only its last message comes back, so say what that message should report.",
    }),
    title: Type.Optional(Type.String({ description: "A short name for the subagent's session." })),
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
    "Run a subagent and get its answer as this call's result. Use it whenever you need the answer this turn; several task calls in one response run in parallel. Give it everything it needs; it does not see this conversation. A new message to you ends the wait early, and the answer reaches you when it finishes.",
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

    return reply(clipText(worktree === null ? answer : `${worktree}\n\n${answer}`, "head"));
  },
};

const create: ToolDefinition<Infer<typeof createParameters>> = {
  name: "create",
  description:
    "Start a subagent in the background and return its id at once, for work you won't wait on or a subagent you'll message again with send. Its answer reaches you on its own when it finishes. When you need the answer this turn, use task instead. Link it in a reply as [short title](agent:<id>).",
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
    "Send a message to a subagent from create. A message sent while it works runs once that work ends, so there is no need to await first. Use await for its answer.",
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
    const receipt = await child.send(args.prompt, {
      id: asId<"receipt">(`${invocation.call}:${child.id}`),
    });
    const view = await child.view();
    const message = [...view.messages, ...view.queue].find((entry) => entry.id === receipt.message);

    return reply(`Sent to subagent ${child.id}; ${scheduled(message)}.`);
  },
};

const awaitChild: ToolDefinition<Infer<typeof awaitParameters>> = {
  name: "await",
  description:
    "Wait for a subagent to finish its current work and return its answer. A new message to you ends the wait early, with the subagent still working.",
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
        clipText(
          await readSubagentReply(child, last.id, {
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

    return reply(clipText(await readSubagentReply(child, run, outcome), "head"));
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

    const transcript = [...view.messages, ...view.queue]
      .flatMap(renderTranscriptMessage)
      .join("\n\n");

    return reply(
      transcript === ""
        ? `Subagent ${child.id} is ${state} and has no messages yet.`
        : clipText(`${transcript}\n\nSubagent ${child.id} is ${state}.`, "tail"),
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

export default {
  id: "subagents",
  async activate(api) {
    if ((await api.session.info()).parent !== null) return;

    for (const definition of [task, create, send, awaitChild, readAgent, stop])
      api.contribute.tools.add(definition);
  },
} satisfies Plugin;

/**
 * A chat that runs as a registered agent starts subagents of its own type: its agent, and its
 * model and thinking level unless the call names a model. Any other chat's subagents run on what
 * the call names and the defaults. An agent no plugin registers is read as the model it names,
 * alone or with `model`, as a model asked for loosely ("astra", or "sol" with "6.1") often is.
 */
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
  const models = await listModels(invocation);
  const matches = matchModels(models, name);
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

/** The one model `agent`, which no plugin registers, names with `model`, with `model` alone or by itself. */
async function findAgentModel(
  invocation: ToolInvocation,
  agent: string,
  model: string | undefined,
): Promise<ModelRef> {
  const models = await listModels(invocation);
  const names = model === undefined ? [agent] : [model, `${agent} ${model}`, agent];

  const [found] = names.flatMap((name) => {
    const matches = matchModels(models, name);

    return matches.length === 1 ? matches : [];
  });

  if (found === undefined) throw new Error(`No agent is registered as ${agent}.`);

  return found;
}

async function listModels(invocation: ToolInvocation): Promise<readonly ModelInfo[]> {
  return (await invocation.sdk.models.list()).providers.flatMap((provider) =>
    provider.credential === "unknown" ||
    provider.credential === "configured" ||
    provider.credential === "verified"
      ? provider.models
      : [],
  );
}

/** The refs `name` means: its exact `provider/id`, else its exact id, else the closest loose match. */
function matchModels(models: readonly ModelInfo[], name: string): readonly ModelRef[] {
  const refs = models.flatMap((info) => (info.fast === null ? [info.ref] : [info.ref, info.fast]));
  const exact = refs.filter((ref) => `${ref.provider}/${ref.id}` === name);

  if (exact.length > 0) return exact;
  const ids = refs.filter((ref) => ref.id === name);

  return ids.length > 0 ? ids : closestModels(refs, name);
}

/**
 * The refs a loosely written name means: those whose `provider/id` holds every word of `name`,
 * letters and numbers apart, with the fewest other words in the id. "sol 6.1" finds gpt-6.1-sol
 * and "astra" gpt-6-astra over its fast variant. A name with no letters means none.
 */
function closestModels(refs: readonly ModelRef[], name: string): readonly ModelRef[] {
  const wanted = modelWords(name);

  if (!wanted.some((word) => /[a-z]/u.test(word))) return [];

  const held = refs.flatMap((ref) => {
    const words = modelWords(`${ref.provider}/${ref.id}`);

    return wanted.every((word) => countWord(words, word) >= countWord(wanted, word))
      ? [{ ref, extra: modelWords(ref.id).length }]
      : [];
  });

  const fewest = Math.min(...held.map((entry) => entry.extra));

  return held.flatMap((entry) => (entry.extra === fewest ? [entry.ref] : []));
}

function modelWords(source: string): readonly string[] {
  return source.toLowerCase().match(/[a-z]+|\d+/gu) ?? [];
}

function countWord(words: readonly string[], word: string): number {
  return words.filter((entry) => entry === word).length;
}

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
  if (message.kind === "user")
    return [
      `User: ${typeof message.content === "string" ? message.content : message.content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join(" ")}`,
    ];

  if (isPart(message, text))
    return message.state.markdown === "" ? [] : [`Assistant: ${message.state.markdown}`];

  if (isPart(message, tool)) {
    const state = message.state;
    const status = state.phase === "settled" ? state.outcome.kind : state.phase;

    return [`Tool ${state.name}(${JSON.stringify(state.args)}): ${status}`];
  }

  return [];
}
