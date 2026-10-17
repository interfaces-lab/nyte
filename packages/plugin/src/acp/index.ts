import {
  acquireSessionResources,
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
import { processEnvironment } from "@nyte-ai/core";
import type { ExecutionEnv, PluginApi, ToolDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { Plugin } from "../core.ts";
import { AcpProcess } from "./connection.ts";
import { installedAgents, REGISTRY_URL, registryEntries } from "./registry.ts";
import seed from "./registry-seed.json" with { type: "json" };
import type { AcpAgent } from "./registry.ts";
import type { AcpThread } from "./thread.ts";
import { messageKey, transcriptText, userBlocks } from "./transcript.ts";
import { ACP_API, ACP_PROVIDER, MIRROR_TOOL, mirrorArguments, mirrorClass } from "./translate.ts";
import type { MirrorArguments } from "./translate.ts";

export type { AcpAgent } from "./registry.ts";

const NOT_RUNNING = "The agent is no longer running this turn. Send a message to continue.";

const REGISTRY_TTL_MS = 24 * 60 * 60 * 1_000;

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

function agentModel(agent: AcpAgent): Model<Api> {
  return {
    id: agent.id,
    name: agent.name,
    api: ACP_API,
    provider: ACP_PROVIDER,
    baseUrl: `process://acp/${agent.id}`,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 64_000,
  };
}

function mirrorTool(live: ReadonlyMap<string, Live>): ToolDefinition<MirrorArguments> {
  return {
    name: MIRROR_TOOL,
    description: "A tool an ACP agent ran. The agent reports the result; Nyte records it.",
    parameters: standard(mirrorArguments),
    exposure: "hidden",
    approval: "runtime",
    replay: "safe",
    class: mirrorClass,
    async execute(args, invocation) {
      const thread = live.get(invocation.session.id)?.thread;

      if (thread === undefined || thread.closed || args.thread !== thread.prefix)
        throw new Error(NOT_RUNNING);
      thread.recording(args.id);
      const output = await thread.result(args.id, invocation.signal);

      if (output.failed)
        throw new Error(output.text === "" ? "The tool call failed." : output.text);

      return { content: [{ kind: "text", text: output.text }] };
    },
  };
}

/**
 * Agent Client Protocol agents as one model API: each ACP registry agent
 * installed on this machine is a model of the `acp` provider, run as a
 * process in the session's environment. Its text and thoughts stream as the
 * assistant's, each of its tool calls is recorded as a hidden `acp` mirror
 * call, and a permission it asks for waits until Nyte records that call and
 * is then decided by `PluginApi.approve` under the call's ACP kind (a call
 * Nyte settles without running is refused). A stopped run cancels the
 * agent's turn. The registry list is fetched on a
 * networked catalog refresh at most daily and kept in the models store;
 * before the first fetch, the list shipped in `registry-seed.json` stands in.
 * `agents`, when given, replaces the registry lookup, as tests do.
 */
export function acpAgents(options?: { readonly agents?: () => Promise<readonly AcpAgent[]> }) {
  let agents: readonly AcpAgent[] = [];
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
    model: Model<Api>,
  ): Promise<{ readonly entry: Live; readonly binding: Binding; readonly agent: AcpProcess }> {
    const binding = bindings.get(id);

    if (binding === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { env } = binding;
    const agent = agents.find((candidate) => candidate.id === model.id);

    if (agent === undefined) throw new Error(`${model.name} is not installed on this machine.`);
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

  async function respond(
    model: Model<Api>,
    context: TranscriptContext,
    signal: AbortSignal | undefined,
    id: string | undefined,
  ): Promise<AssistantMessageEventStream> {
    if (id === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { entry, binding, agent } = await connect(id, model);
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

      if (prompt.length > 0) thread.send(prompt);
    } else {
      if (current !== undefined) agent.forget(current);

      if (prompt.length === 0) throw new Error(NOT_RUNNING);
      thread = await agent.open(binding.env.cwd, binding.approve);
      entry.thread = thread;
      const history = transcriptText(messages.slice(0, first));

      thread.send(
        history === ""
          ? prompt
          : [{ type: "text", text: `Earlier in this conversation:\n\n${history}` }, ...prompt],
      );
    }

    const stream = thread.respond(model, signal);

    void stream.result().then((message) => {
      if (entry.thread !== thread) return;
      entry.known =
        message.stopReason === "error" || message.stopReason === "aborted"
          ? []
          : [...keys, messageKey(message)];
    });

    return stream;
  }

  async function answerOnce(
    model: Model<Api>,
    context: TranscriptContext,
    signal: AbortSignal | undefined,
    id: string | undefined,
  ): Promise<AssistantMessageEventStream> {
    if (id === undefined) throw new Error("ACP agents answer inside a Nyte session.");
    const { binding, agent } = await connect(id, model);
    const thread = await agent.open(binding.env.cwd, binding.approve);
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

    const stream = thread.respond(model, signal, false);
    void stream.result().finally(() => agent.forget(thread));

    return stream;
  }

  const stream = (
    model: Model<Api>,
    context: TranscriptContext,
    request?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    lazyStream(model, () =>
      getCurrentTools(context.messages).length === 0
        ? answerOnce(model, context, request?.signal, request?.sessionId)
        : respond(model, context, request?.signal, request?.sessionId),
    );

  const provider: Provider = {
    id: ACP_PROVIDER,
    name: "ACP agents",
    baseUrl: "process://acp",
    capabilities: { steer: false },
    auth: {
      apiKey: {
        name: "Installed ACP agents",
        resolve: async ({ signal }) => {
          signal.throwIfAborted();

          return agents.length === 0 ? undefined : { auth: {}, source: "Installed ACP agents" };
        },
      },
    },
    getModels: () => agents.map(agentModel),
    refreshModels: async (context) => {
      if (options?.agents !== undefined) {
        const found = await options.agents();
        await context.publish({ update: () => (agents = found) });

        return;
      }

      const stored = context.stored;
      let entries = stored?.models ?? registryEntries(seed);
      let persist: { readonly models: readonly unknown[]; readonly checkedAt: number } | undefined;

      const stale =
        stored?.checkedAt === undefined || Date.now() - stored.checkedAt > REGISTRY_TTL_MS;

      if (context.allowNetwork && (context.force === true || stale)) {
        const response = await context.catalog.fetch(REGISTRY_URL, { signal: context.signal });

        if (!response.ok) throw new Error(`The ACP registry answered ${String(response.status)}.`);
        entries = registryEntries(await response.json());
        persist = { models: entries, checkedAt: Date.now() };
      }

      await processEnvironment();
      const found = await installedAgents(entries, process.env.PATH ?? "");
      await context.publish({ persist, update: () => (agents = found) });
    },
    stream: (model, context, streamOptions) =>
      stream(model, context, {
        signal: streamOptions?.signal,
        sessionId: streamOptions?.sessionId,
      }),
    streamSimple: stream,
  };

  const plugin = {
    id: "acp",
    contribute: { tools: [mirrorTool(live)] },
    activate(api) {
      const id = api.session.id;
      const binding: Binding = {
        env: api.env,
        approve: (call, signal) => api.approve(call, signal),
      };
      const release = acquireSessionResources(id);
      bindings.set(id, binding);

      const unbind = () => {
        if (bindings.get(id) === binding) bindings.delete(id);
        release();
      };

      if (api.signal.aborted) unbind();
      else api.signal.addEventListener("abort", unbind, { once: true });
    },
  } satisfies Plugin;

  return { provider, plugin };
}
