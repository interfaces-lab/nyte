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
import type { ExecutionEnv, PluginApi, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import type { ToolResult } from "@nyte-ai/schema";
import { standard } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { Plugin } from "../core.ts";
import { agentCatalog, agentChoice } from "./catalog.ts";
import type { AcpAgent, AgentRoute } from "./catalog.ts";
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

type Answer = (
  route: AgentRoute,
  model: Model<Api>,
  context: TranscriptContext,
  request: SimpleStreamOptions | undefined,
) => Promise<AssistantMessageEventStream>;

interface Binding {
  readonly env: ExecutionEnv;
  readonly approve: PluginApi<"core">["approve"];
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
  ): Promise<{ readonly entry: Live; readonly binding: Binding; readonly agent: AcpProcess }> {
    const binding = bindings.get(id);

    if (binding === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { env } = binding;
    const key = JSON.stringify([agent.id, agent.command, env.cwd]);
    let entry = live.get(id);
    const started = entry?.key === key ? await entry.process.catch(() => undefined) : undefined;

    if (entry === undefined || started === undefined || started.closed) {
      if (entry !== undefined) forget(entry);
      entry = { key, process: AcpProcess.start(env, agent), thread: undefined, known: [] };
      live.set(id, entry);
    }

    return { entry, binding, agent: await entry.process };
  }

  const respond: Answer = async (route, model, context, request) => {
    const id = request?.sessionId;

    if (id === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { entry, binding, agent } = await connect(id, route.agent);
    const choice = agentChoice(route, request?.reasoning);
    const messages = context.messages.filter((message) => message.role !== "system");
    const keys = messages.map(messageKey);
    const images = await agent.images();
    const first = messages.findLastIndex((message) => message.role !== "user") + 1;

    const prompt = messages
      .slice(first)
      .flatMap((message) => (message.role === "user" ? userBlocks(message, images) : []));

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
      }
    } else {
      if (current !== undefined) agent.forget(current);

      if (prompt.length === 0) throw new Error(NOT_RUNNING);
      thread = await ready(agent, binding, choice, request?.signal);
      entry.thread = thread;
      const history = transcriptText(messages.slice(0, first));

      thread.send(
        history === ""
          ? prompt
          : [{ type: "text", text: `Earlier in this conversation:\n\n${history}` }, ...prompt],
      );
    }

    const stream = thread.respond(model, request?.signal);

    void stream.result().then((message) => {
      if (entry.thread !== thread) return;
      entry.known =
        message.stopReason === "error" || message.stopReason === "aborted"
          ? []
          : [...keys, messageKey(message)];
    });

    return stream;
  };

  const answerOnce: Answer = async (route, model, context, request) => {
    const id = request?.sessionId;

    if (id === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { binding, agent } = await connect(id, route.agent);
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
        { env: api.env, approve: (call, signal) => api.approve(call, signal) },
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

async function ready(
  agent: AcpProcess,
  binding: Binding,
  choice: AgentChoice,
  signal: AbortSignal | undefined,
): Promise<AcpThread> {
  const thread = await agent.open(binding.env.cwd, binding.approve);

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
