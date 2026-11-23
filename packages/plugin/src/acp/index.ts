import { createHash } from "node:crypto";
import {
  bindSession,
  getCurrentSystemPrompt,
  getCurrentTools,
  lazyStream,
  registerSessionResourceCleanup,
} from "@nyte-ai/ai";
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  Provider,
  SimpleStreamOptions,
  TranscriptContext,
} from "@nyte-ai/ai";
import type { CreateElicitationResponse } from "@agentclientprotocol/sdk/unstable";
import type {
  ExecutionEnv,
  PluginApi,
  PluginStorage,
  ToolDefinition,
  ToolInvocation,
} from "@nyte-ai/core";
import type { ToolResult } from "@nyte-ai/schema";
import { asId, standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Plugin } from "../core.ts";
import { agentCatalog, agentChoice } from "./catalog.ts";
import type { AcpAgent, AcpLaunch, AgentRoute } from "./catalog.ts";
import { AcpProcess } from "./connection.ts";
import type { AgentChoice } from "./connection.ts";
import type { AcpThread } from "./thread.ts";
import type { AgentForm } from "./forms.ts";
import { question } from "../question/question.ts";
import { answerInput } from "../question/schema.ts";
import { messageKey, transcriptText, userBlocks } from "./transcript.ts";
import { MIRROR_TOOL, mirrorArguments, mirrorClass } from "./translate.ts";
import type { MirrorArguments } from "./translate.ts";

export type { AcpAgent } from "./catalog.ts";

const NOT_RUNNING = "The agent is no longer running this turn. Send a message to continue.";

const UNATTENDED = "Run every tool without asking";

const RECONNECTED =
  "Nyte lost its connection to you and has reconnected to this conversation. Carry on where you left off.";

const SAVED = "conversation";

const savedConversation = Type.Object({
  agent: Type.String(),
  session: Type.String(),
  seen: Type.Integer({ minimum: 0 }),
  digest: Type.String(),
});

type Answer = (
  route: AgentRoute,
  model: Model<Api>,
  context: TranscriptContext,
  request: SimpleStreamOptions | undefined,
) => Promise<AssistantMessageEventStream>;

interface Binding {
  readonly env: ExecutionEnv;
  readonly approve: PluginApi<"core">["approve"];
  readonly wake: (agent: string) => void;
  readonly storage: PluginStorage;
}

interface Live {
  readonly key: string;
  readonly process: Promise<AcpProcess>;
  thread: AcpThread | undefined;
  known: readonly string[];
}

function mirrorTool(live: ReadonlyMap<string, Live>): ToolDefinition<MirrorArguments> {
  return {
    name: MIRROR_TOOL,
    description: "A tool an ACP agent ran. The agent reports the result; Nyte records it.",
    parameters: standard(mirrorArguments),
    exposure: "hidden",
    asks: "runtime",
    rerun: "safe",
    class: mirrorClass,
    async execute(args, invocation) {
      const thread = live.get(invocation.session.id)?.thread;

      if (thread === undefined || thread.closed || args.thread !== thread.prefix)
        throw new Error(NOT_RUNNING);
      const form = thread.findForm(args.id);

      if (form !== undefined) return askForm(thread, args.id, form, invocation);
      thread.recording(args.id);
      const output = await thread.result(args.id, invocation.signal, (text) =>
        invocation.progress({ text }),
      );

      if (output.failed)
        throw new Error(output.text === "" ? "The tool call failed." : output.text);

      return { content: [{ kind: "text", text: output.text }] };
    },
  };
}

async function askForm(
  thread: AcpThread,
  id: string,
  form: AgentForm,
  invocation: ToolInvocation,
): Promise<ToolResult<unknown>> {
  let response: CreateElicitationResponse = { action: "cancel" };

  try {
    const part = await invocation.session.parts.create(question, {
      state: { call: invocation.call, questions: [...form.questions], phase: { kind: "asking" } },
      placement: { kind: "modal" },
    });
    const outcome = await invocation.wait({ kind: "part", part: part.id });
    const checked =
      outcome.kind === "part" && outcome.answer?.action === "answer"
        ? await answerInput["~standard"].validate(outcome.answer.input)
        : undefined;

    response =
      checked !== undefined && !(checked instanceof Promise) && checked.issues === undefined
        ? form.respond(checked.value.answers)
        : { action: "decline" };

    return {
      content: [
        {
          kind: "text",
          text: response.action === "accept" ? "The user answered." : "The user declined.",
        },
      ],
      parts: [part.id],
    };
  } finally {
    thread.answerForm(id, response);
  }
}

export function acpAgents(agents: readonly AcpAgent[]): readonly Plugin[] {
  const live = new Map<string, Live>();
  const bindings = new Map<string, Binding>();

  const forget = (entry: Live): void => {
    void entry.process.then((started) => started.close()).catch(() => undefined);
  };

  registerSessionResourceCleanup((id) => {
    for (const [key, entry] of live) {
      if (id !== undefined && key !== id) continue;
      live.delete(key);
      forget(entry);
    }
  });

  async function connect(
    id: string,
    agent: AcpAgent,
    signal: AbortSignal | undefined,
  ): Promise<{ readonly entry: Live; readonly binding: Binding; readonly agent: AcpProcess }> {
    const binding = bindings.get(id);

    if (binding === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { env } = binding;
    const key = JSON.stringify([agent.id, agent.command, env.cwd]);
    let entry = live.get(id);
    const started = entry?.key === key ? await entry.process.catch(() => undefined) : undefined;

    if (entry === undefined || started === undefined || started.closed) {
      if (entry !== undefined) forget(entry);

      entry = {
        key,
        process: chooseLaunch(agent, binding, signal).then((launch) =>
          AcpProcess.start(env, agent, launch),
        ),
        thread: undefined,
        known: [],
      };
      live.set(id, entry);
    }

    return { entry, binding, agent: await entry.process };
  }

  const respond: Answer = async (route, model, context, request) => {
    const id = request?.sessionId;

    if (id === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { entry, binding, agent } = await connect(id, route.agent, request?.signal);
    const choice = agentChoice(route, request?.reasoning);
    const messages = context.messages.filter((message) => message.role !== "system");
    const keys = messages.map(messageKey);
    const images = await agent.images();
    const first = messages.findLastIndex((message) => message.role !== "user") + 1;
    const note = messageKey({ role: "user", content: wakeNote(route.agent.name), timestamp: 0 });
    const woken = keys.at(-1) === note;

    const prompt = messages
      .slice(first)
      .flatMap((message) =>
        message.role === "user" && messageKey(message) !== note ? userBlocks(message, images) : [],
      );

    const current = entry.thread;

    const continues =
      current !== undefined &&
      !current.closed &&
      entry.known.length < keys.length &&
      entry.known.every((known, index) => keys[index] === known);

    let thread: AcpThread;

    if (continues) {
      thread = current;

      const answered = new Set(
        messages.flatMap((message) => (message.role === "toolResult" ? [message.toolCallId] : [])),
      );

      for (const message of messages)
        if (message.role === "assistant")
          for (const block of message.content)
            if (
              block.type === "toolCall" &&
              answered.has(block.id) &&
              Value.Check(mirrorArguments, block.arguments) &&
              block.arguments.thread === thread.prefix
            )
              thread.skip(block.arguments.id);

      if (prompt.length > 0) {
        await agent.choose(thread, choice);
        request?.signal?.throwIfAborted();
        thread.send(prompt);
      } else if (woken) thread.drainWake();
    } else {
      if (current !== undefined) agent.forget(current);

      const reattached =
        current === undefined
          ? await reattach(agent, binding, choice, request?.signal, keys)
          : undefined;

      if (reattached !== undefined) {
        thread = reattached.thread;

        const missed = messages
          .slice(reattached.seen)
          .flatMap((message) =>
            message.role === "user" && messageKey(message) !== note
              ? userBlocks(message, images)
              : [],
          );

        thread.send(missed.length > 0 ? missed : [{ type: "text", text: RECONNECTED }]);
      } else {
        if (prompt.length === 0) throw new Error(NOT_RUNNING);
        thread = await ready(agent, binding, choice, request?.signal);
        const history = transcriptText(messages.slice(0, first));

        thread.send(
          history === ""
            ? prompt
            : [{ type: "text", text: `Earlier in this conversation:\n\n${history}` }, ...prompt],
        );
      }

      entry.thread = thread;
    }

    const stream = thread.respond(model, request?.signal);

    void stream.result().then((message) => {
      if (entry.thread !== thread) return;

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        entry.known = [];

        return;
      }

      entry.known = [...keys, messageKey(message)];
      void binding.storage
        .set(SAVED, {
          agent: agent.agent.id,
          session: thread.session,
          seen: entry.known.length,
          digest: digest(entry.known),
        })
        .catch(() => undefined);
    });

    return stream;
  };

  const answerOnce: Answer = async (route, model, context, request) => {
    const id = request?.sessionId;

    if (id === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { binding, agent } = await connect(id, route.agent, request?.signal);
    const thread = await ready(
      agent,
      binding,
      agentChoice(route, request?.reasoning),
      request?.signal,
    );
    const system = getCurrentSystemPrompt(context.messages);

    const conversation = transcriptText(
      context.messages.filter((message) => message.role !== "system"),
    );

    thread.send([
      {
        type: "text",
        text: `${system === undefined ? "" : `${system}\n\n`}${conversation}\n\nAnswer in text only; do not use tools.`,
      },
    ]);

    const stream = thread.respond(model, request?.signal, false);
    void stream.result().finally(() => agent.forget(thread));

    return stream;
  };

  const answer: Answer = (route, model, context, request) =>
    getCurrentTools(context.messages).length === 0
      ? answerOnce(route, model, context, request)
      : respond(route, model, context, request);

  const support = {
    id: "acp",
    contribute: { tools: [mirrorTool(live)] },
    activate(api) {
      bindSession(
        bindings,
        api.session.id,
        {
          env: api.env,
          storage: api.storage.at("session"),
          approve: (call, signal) => api.approve(call, signal),
          wake: (agent) =>
            void api.session
              .head(asId<"head">("main"))
              .send(wakeNote(agent), {
                delivery: "queue",
                source: { kind: "action", label: agent },
              })
              .catch(() => undefined),
        },
        api.signal,
      );

      return {};
    },
  } satisfies Plugin;

  return [
    support,
    ...agents.map((agent): Plugin => ({ id: agent.id, provider: agentProvider(agent, answer) })),
  ];
}

/** Takes back the agent's conversation this chat saved, when the chat still starts with what the agent saw. */
async function reattach(
  agent: AcpProcess,
  binding: Binding,
  choice: AgentChoice,
  signal: AbortSignal | undefined,
  keys: readonly string[],
): Promise<{ readonly thread: AcpThread; readonly seen: number } | undefined> {
  const saved = await binding.storage.get(SAVED);

  if (
    !Value.Check(savedConversation, saved) ||
    saved.agent !== agent.agent.id ||
    saved.seen > keys.length ||
    digest(keys.slice(0, saved.seen)) !== saved.digest
  ) {
    return undefined;
  }

  const thread = await ready(agent, binding, choice, signal, saved.session).catch(() => undefined);

  return thread === undefined ? undefined : { thread, seen: saved.seen };
}

function digest(keys: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(keys)).digest("hex");
}

function wakeNote(agent: string): string {
  return `${agent} continued on its own.`;
}

async function chooseLaunch(
  agent: AcpAgent,
  binding: Binding,
  signal: AbortSignal | undefined,
): Promise<AcpLaunch> {
  if (agent.unattended === undefined) return agent.launch;

  const verdict = await binding.approve(
    { name: agent.name, class: { kind: "custom", label: UNATTENDED } },
    signal ?? new AbortController().signal,
  );

  return verdict.kind === "allow" ? agent.unattended : agent.launch;
}

async function ready(
  agent: AcpProcess,
  binding: Binding,
  choice: AgentChoice,
  signal: AbortSignal | undefined,
  resume?: string,
): Promise<AcpThread> {
  const thread = await agent.open(
    binding.env.cwd,
    binding.approve,
    () => binding.wake(agent.agent.name),
    resume,
  );

  try {
    await agent.choose(thread, choice);
    signal?.throwIfAborted();

    return thread;
  } catch (error) {
    agent.forget(thread);
    throw error;
  }
}

function agentProvider(agent: AcpAgent, answer: Answer): Provider {
  let routes: readonly AgentRoute[] = [];

  const stream = (
    model: Model<Api>,
    context: TranscriptContext,
    request?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    lazyStream(model, async () => {
      const route = routes.find((candidate) => candidate.model.id === model.id);

      if (route === undefined) throw new Error(`${model.name} is not installed on this machine.`);

      return answer(route, model, context, request);
    });

  return {
    id: agent.id,
    name: agent.name,
    baseUrl: `process://acp/${agent.id}`,
    capabilities: { steer: false },
    explicitOnly: true,
    auth: {
      apiKey: {
        name: `${agent.name} on this machine`,
        resolve: async ({ signal }) => {
          signal.throwIfAborted();

          return routes.length === 0 ? undefined : { auth: {}, source: agent.name };
        },
      },
    },
    getModels: () => routes.map((route) => route.model),
    refreshModels: async (context) => {
      const catalog = await agentCatalog(agent, context);
      await context.publish({ persist: catalog.persist, update: () => (routes = catalog.routes) });
    },
    stream: (model, context, options) =>
      stream(model, context, { signal: options?.signal, sessionId: options?.sessionId }),
    streamSimple: stream,
  };
}
