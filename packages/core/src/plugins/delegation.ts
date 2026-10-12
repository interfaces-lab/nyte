import { asId, standard } from "@nyte-ai/schema";
import type {
  Infer,
  Message,
  RunEnd,
  RunId,
  SessionView,
  ToolResult,
  WaitOutcome,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import { isPart, text, tool } from "../parts.ts";
import type { Plugin } from "../plugin.ts";
import type { SendReceipt } from "../receipt.ts";
import type { Session } from "../session.ts";
import { textOf } from "../session-state.ts";
import type { ToolDefinition, ToolInvocation } from "../tools.ts";

const ANSWER_LIMIT = 16_000;

const TRANSCRIPT_LIMIT = 16_000;

const taskParameters = standard(
  Type.Object({
    prompt: Type.String({
      description: "The task for the subagent, with everything it needs to know.",
    }),
    title: Type.Optional(Type.String({ description: "A short name for the subagent's session." })),
    agent: Type.Optional(
      Type.String({ description: "A registered agent to run as; the default agent otherwise." }),
    ),
  }),
);

const createParameters = standard(
  Type.Object({
    title: Type.Optional(Type.String({ description: "A short name for the subagent's session." })),
    agent: Type.Optional(
      Type.String({ description: "A registered agent to run as; the default agent otherwise." }),
    ),
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

/** Creates a child session, sends it the prompt and waits for the run it landed in, returning that run's last text; a re-run replays the child, the send and the wait. */
const task: ToolDefinition<Infer<typeof taskParameters>> = {
  name: "task",
  description:
    "Run a subagent on a task and wait for its answer. Give it everything it needs; it does not see this conversation.",
  parameters: taskParameters,
  class: (args) => ({ kind: "delegate", child: null, role: "task", title: args.title ?? null }),
  replay: "safe",
  async execute(args, invocation) {
    const child = await invocation.sdk.sessions.create({
      parent: invocation.session.id,
      name: args.title,
      configuration: args.agent === undefined ? undefined : { agent: args.agent },
    });

    const run = await invocation.memo("run", async () => {
      const landing = await (await sendOnce(invocation, child, args.prompt)).landed();

      return landing.kind === "landed" ? landing.run : null;
    });

    if (run === null) return reply(`Subagent ${child.id} did not start the task.`);
    const outcome = await invocation.wait({ kind: "run", session: child.id, run });

    return reply(await answerOf(child, run, outcome));
  },
};

/** Creates a child session without sending to it, with `role` as its own prompt layer (`prompt: { kind: "layer", text }`) and `agent` in its configuration, and returns its id. */
const create: ToolDefinition<Infer<typeof createParameters>> = {
  name: "create",
  description:
    "Create a subagent session and return its id, to send it messages and await it later.",
  parameters: createParameters,
  class: (args) => ({ kind: "delegate", child: null, role: "create", title: args.title ?? null }),
  replay: "safe",
  async execute(args, invocation) {
    const child = await invocation.sdk.sessions.create({
      parent: invocation.session.id,
      name: args.title,
      configuration: args.agent === undefined ? undefined : { agent: args.agent },
      prompt: args.role === undefined ? undefined : { kind: "layer", text: args.role },
    });

    return reply(`Created subagent ${child.id}.`);
  },
};

/** Sends a message to a child of this session (memoised, so a re-run sends once) and returns at once with what admission scheduled; a session that is not this session's child fails the call. */
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
  replay: "safe",
  async execute(args, invocation) {
    const child = await childOf(invocation, args.session);
    const receipt = await sendOnce(invocation, child, args.prompt);
    const view = await child.view();
    const message = view.messages.find((entry) => entry.id === receipt.message);

    return reply(`Sent to subagent ${child.id}; ${scheduled(message)}.`);
  },
};

/** Waits for a child's live run to end, up to `timeout` seconds after the step's recorded clock, and returns its answer; an idle child returns its last answer at once. */
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
    const child = await childOf(invocation, args.session);
    const run = await invocation.memo("run", async () => liveRunOf(await child.view()));

    if (run === null) {
      const execution = (await child.view()).execution;
      const last = execution.kind === "idle" ? execution.lastRun : null;

      if (last === null) return reply(`Subagent ${child.id} has not worked on anything yet.`);

      return reply(
        await answerOf(child, last.id, {
          kind: "run",
          session: child.id,
          run: last.id,
          end: last.end,
        }),
      );
    }

    const outcome = await invocation.wait(
      args.timeout === undefined
        ? { kind: "run", session: child.id, run }
        : {
            kind: "run",
            session: child.id,
            run,
            deadline: invocation.now() + args.timeout * 1000,
          },
    );

    return reply(await answerOf(child, run, outcome));
  },
};

/** Returns a child's transcript as text, bounded from the end: its messages' text, tool calls as one line each, and whether it is working, waiting or idle. */
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
  replay: "safe",
  async execute(args, invocation) {
    const child = await childOf(invocation, args.session);
    const view = await child.view();
    const execution = view.execution.kind;

    const state = execution === "idle" ? "idle" : execution === "waiting" ? "waiting" : "working";

    const transcript = fromEnd(view.messages.flatMap(lineOf).join("\n\n"), TRANSCRIPT_LIMIT);

    return reply(
      transcript === ""
        ? `Subagent ${child.id} is ${state} and has no messages yet.`
        : `Subagent ${child.id} is ${state}.\n\n${transcript}`,
    );
  },
};

/** Stops a child's work (`session.stop()` on the child: every live run fenced, pending inputs withdrawn) and returns what was stopped. */
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
  replay: "safe",
  async execute(args, invocation) {
    const child = await childOf(invocation, args.session);
    const { stopped, withdrawn } = await child.stop();

    return reply(
      `Stopped ${stopped.length} run${stopped.length === 1 ? "" : "s"} of subagent ${child.id} and withdrew ${withdrawn.length} pending message${withdrawn.length === 1 ? "" : "s"}.`,
    );
  },
};

/** Contributes the subagent tools (decision 13, §38r): `task`, `create`, `send`, `await`, `read_agent` and `stop`, each a `delegate` call over the calling session's children. */
export const delegationPlugin: Plugin<"core"> = {
  id: "delegation",
  contribute: { tools: [task, create, send, awaitChild, readAgent, stop] },
};

/** Returns a tool result of one text. */
function reply(content: string): ToolResult<unknown> {
  return { content: [{ kind: "text", text: content }] };
}

/** Returns a child of the calling session by id; a session that is not its child fails the call. */
async function childOf(invocation: ToolInvocation, id: string): Promise<Session> {
  const child = invocation.sdk.session(asId<"session">(id));

  if ((await child.info()).parent !== invocation.session.id)
    throw new Error(`Session ${id} is not a subagent of this session.`);

  return child;
}

/** Sends a prompt to a child's main head under a receipt id keyed by the call, so a re-run of the step replays the send instead of sending again. */
function sendOnce(
  invocation: ToolInvocation,
  child: Session,
  prompt: string,
): Promise<SendReceipt> {
  return child.send(prompt, { id: asId<"receipt">(`${invocation.call}:${child.id}`) });
}

/** Returns the run a child's head is working in, or null when it is idle. */
function liveRunOf(view: SessionView): RunId | null {
  return view.execution.kind === "idle" ? null : view.execution.run.id;
}

/** Returns a child's answer from one run: how the wait ended, then the last text the run wrote, bounded. */
async function answerOf(child: Session, run: RunId, outcome: WaitOutcome): Promise<string> {
  const header = `Subagent ${child.id} ${endOf(outcome)}.`;
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

/** Returns how a wait on a child's run ended, as words. */
function endOf(outcome: WaitOutcome): string {
  if (outcome.kind === "run") return endedAs(outcome.end);

  return outcome.kind === "stopped"
    ? "is still working; this call was stopped before it ended"
    : "is still working";
}

/** Returns how a run ended, as words. */
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

/** Returns what admission did with a message sent to a child, as words. */
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
  }
}

/** Returns one transcript message as text: user text, the assistant's text, a tool call in one line; nothing for the rest. */
function lineOf(message: Message): readonly string[] {
  if (message.kind === "user") return [`User: ${textOf(message.content)}`];

  if (isPart(message, text))
    return message.state.markdown === "" ? [] : [`Assistant: ${message.state.markdown}`];

  if (isPart(message, tool)) {
    const state = message.state;
    const status = state.phase === "settled" ? state.outcome.kind : state.phase;

    return [`Tool ${state.name}(${JSON.stringify(state.args)}): ${status}`];
  }

  return [];
}

/** Returns text cut to `limit` characters from its start, saying so. */
function fromStart(content: string, limit: number): string {
  return content.length > limit
    ? `${content.slice(0, limit)}\n\n[… cut at ${limit} characters]`
    : content;
}

/** Returns text cut to its last `limit` characters, saying so. */
function fromEnd(content: string, limit: number): string {
  return content.length > limit ? `[… earlier messages cut]\n\n${content.slice(-limit)}` : content;
}
