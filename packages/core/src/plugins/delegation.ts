import { asId, standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "../plugin.ts";
import type { ToolDefinition } from "../tools.ts";

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

/** Creates a child session (`invocation.sdk.sessions.create({ parent, name: title, configuration: { agent } })`, an acquisition of the step), sends the prompt to its main head, waits for the run it landed in (`wait({ kind: "run" })`) and returns the child's answer: the last text of that run, bounded, headed by the child id and how the run ended. Replays as a durable step: the child, the send (memoised) and the wait come back on a re-run. */
const task: ToolDefinition<Infer<typeof taskParameters>> = {
  name: "task",
  description:
    "Run a subagent on a task and wait for its answer. Give it everything it needs; it does not see this conversation.",
  parameters: taskParameters,
  class: (args) => ({ kind: "delegate", child: null, role: "task", title: args.title ?? null }),
  replay: "safe",
  execute(args, invocation) {
    throw new Error("not implemented");
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
  execute(args, invocation) {
    throw new Error("not implemented");
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
  execute(args, invocation) {
    throw new Error("not implemented");
  },
};

/** Waits for a child's live run to end (`wait({ kind: "run", deadline })`, the deadline `timeout` seconds after the step's recorded clock) and returns its answer as `task` does; an idle child returns its last answer at once; a passed deadline returns that it still works. */
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
  execute(args, invocation) {
    throw new Error("not implemented");
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
  execute(args, invocation) {
    throw new Error("not implemented");
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
  execute(args, invocation) {
    throw new Error("not implemented");
  },
};

/** Contributes the subagent tools (decision 13 as amended by §38r), each of `ToolClass` `delegate` with its role: `task` (create, send, wait), `create`, `send`, `await`, `read_agent` (role `read`; `read` is the environment's file tool) and `stop`. Every child is a session whose parent is the calling session; a tool naming a session that is not one of its children fails the call. */
export const delegationPlugin: Plugin<"core"> = {
  id: "delegation",
  contribute: { tools: [task, create, send, awaitChild, readAgent, stop] },
};
