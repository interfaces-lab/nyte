import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import {
  acquireSessionResources,
  anthropicProvider,
  clampThinkingLevel,
  createAssistantMessageEventStream,
  getCurrentTools,
  getCurrentSystemPrompt,
  lazyStream,
  registerSessionResourceCleanup,
} from "@nyte-ai/ai";
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  Provider,
  SimpleStreamOptions,
  ThinkingLevel,
  TranscriptContext,
} from "@nyte-ai/ai";
import { processEnvironment } from "@nyte-ai/core";
import type { Plugin } from "../core.ts";
import { findOnPath } from "../find-on-path.ts";
import { ClaudeCodeSession, isolatedOptions } from "./session.ts";
import type { StartQuery } from "./session.ts";
import { flatPrompt, messageKey, sessionEntries, userBlocks } from "./transcript.ts";
import { CLAUDE_CODE_PROVIDER, emptyMessage, Translator } from "./translate.ts";

const API = "claude-agent-sdk";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly EffortLevel[];

const NOT_RUNNING = "Claude Code is no longer running this turn. Send a message to continue.";

interface Binding {
  readonly cwd: string;
}

function effortFor(
  model: Model<Api>,
  reasoning: ThinkingLevel | undefined,
): EffortLevel | undefined {
  if (reasoning === undefined) return undefined;
  const level = clampThinkingLevel(model, reasoning);

  if (level === "off") return undefined;
  const mapped = model.thinkingLevelMap?.[level] ?? level;

  return EFFORTS.find((effort) => effort === mapped) ?? (level === "minimal" ? "low" : undefined);
}

/** The `claude` the user installed, which the Agent SDK runs: Nyte ships no copy of its own. */
async function findClaudeCode(): Promise<string | undefined> {
  await processEnvironment();

  return await findOnPath("claude", process.env.PATH ?? "");
}

async function claudeCodeConfigured(): Promise<boolean> {
  if ((await findClaudeCode()) === undefined) return false;

  try {
    await access(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));

    return true;
  } catch {
    return false;
  }
}

function answerOnce(
  start: StartQuery,
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output = emptyMessage(model);
  const translator = new Translator(model, output, stream);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options?.signal?.addEventListener("abort", abort, { once: true });

  void (async () => {
    try {
      stream.push({ type: "start", partial: output });

      for await (const message of start({
        prompt: flatPrompt(context.messages),
        options: {
          ...isolatedOptions(await findClaudeCode(), options?.env),
          model: model.id,
          abortController: controller,
          systemPrompt: getCurrentSystemPrompt(context.messages),
          maxTurns: 1,
          persistSession: false,
          includePartialMessages: true,
          thinking: { type: "disabled" },
        },
      })) {
        if (message.type === "stream_event" && message.parent_tool_use_id === null)
          translator.apply(message.event);
        else if (message.type === "result" && message.subtype !== "success")
          throw new Error(message.errors.join("\n") || `Claude Code failed: ${message.subtype}`);
      }

      if (output.stopReason === "pending" || output.stopReason === "aborted")
        throw new Error("Claude Code ended without a response.");

      if (output.stopReason === "error")
        throw new Error(output.errorMessage ?? "Claude Code failed.");
      stream.push({ type: "done", reason: output.stopReason, message: output });
    } catch (error) {
      output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
    } finally {
      options?.signal?.removeEventListener("abort", abort);
      stream.end();
    }
  })();

  return stream;
}

export function claudeCodeSdk(start: StartQuery = query) {
  const catalog = anthropicProvider();
  const sessions = new Map<string, ClaudeCodeSession>();
  const bindings = new Map<string, Binding>();

  registerSessionResourceCleanup((id) => {
    for (const [key, session] of sessions) {
      if (id !== undefined && key !== id) continue;
      sessions.delete(key);
      session.close();
    }
  });

  async function respond(
    model: Model<Api>,
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
  ): Promise<AssistantMessageEventStream> {
    const id = options?.sessionId;
    const binding = id === undefined ? undefined : bindings.get(id);

    if (id === undefined || binding === undefined)
      throw new Error("Claude Code answers inside a Nyte session with the claude-code-sdk plugin.");
    const effort = effortFor(model, options?.reasoning);
    const system = getCurrentSystemPrompt(context.messages);
    const key = JSON.stringify([model.id, binding.cwd, options?.reasoning !== undefined, system]);
    const messages = context.messages.filter((message) => message.role !== "system");
    const keys = messages.map(messageKey);
    const tools = getCurrentTools(context.messages);
    const prompt = messages.slice(messages.findLastIndex((message) => message.role !== "user") + 1);
    let session = sessions.get(id);

    if (session === undefined || !session.follows(key, keys)) {
      session?.close();

      if (prompt.length === 0) throw new Error(NOT_RUNNING);
      const claudeSession = randomUUID();

      session = new ClaudeCodeSession({
        key,
        model: model.id,
        cwd: binding.cwd,
        system,
        thinking: options?.reasoning !== undefined,
        effort,
        env: options?.env,
        session: claudeSession,
        history: sessionEntries(messages.slice(0, -prompt.length), {
          session: claudeSession,
          model: model.id,
          cwd: binding.cwd,
        }),
        tools,
        query: start,
        claude: await findClaudeCode(),
      });
      sessions.set(id, session);
    }

    session.expose(tools);
    session.deliver(messages);
    await session.configure(effort);

    if (prompt.length > 0)
      session.send(
        prompt.flatMap((message) => (message.role === "user" ? userBlocks(message) : [])),
      );

    return session.respond(model, keys, options?.signal);
  }

  const stream = (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    getCurrentTools(context.messages).length === 0
      ? answerOnce(start, model, context, options)
      : lazyStream(model, () => respond(model, context, options));

  const provider: Provider = {
    id: CLAUDE_CODE_PROVIDER,
    name: "Claude Code",
    baseUrl: "process://claude-code",
    capabilities: { steer: true },
    auth: {
      apiKey: {
        name: "Claude Code login",
        resolve: async ({ signal }) => {
          signal.throwIfAborted();

          return (await claudeCodeConfigured())
            ? { auth: {}, source: "Claude Code login" }
            : undefined;
        },
      },
    },
    getModels: () =>
      catalog.getModels().map(({ compat: _compat, ...model }) => ({
        ...model,
        provider: CLAUDE_CODE_PROVIDER,
        api: API,
        baseUrl: "process://claude-code",
      })),
    refreshModels: async (context) => {
      await catalog.refreshModels?.(context);
    },
    stream: (model, context, options) =>
      stream(model, context, {
        signal: options?.signal,
        sessionId: options?.sessionId,
        env: options?.env,
      }),
    streamSimple: stream,
  };

  const plugin = {
    id: "claude-code-sdk",
    activate(api) {
      const id = api.session.id;
      const binding: Binding = { cwd: api.env.cwd };
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
