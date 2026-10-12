import { randomUUID } from "node:crypto";
import process from "node:process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  EffortLevel,
  Options,
  Query,
  SDKPartialAssistantMessage,
  SDKUserMessage,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  anthropicProvider,
  calculateCost,
  clampThinkingLevel,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  parseStreamingJson,
} from "@nyte-ai/ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  ImageContent,
  Message,
  Model,
  Provider,
  TextContent,
  ThinkingContent,
  ThinkingLevel,
  Tool,
  ToolCall,
  ToolResultMessage,
  TranscriptContext,
} from "@nyte-ai/ai";

type MessageParam = SDKUserMessage["message"];

type ContentBlock = Exclude<MessageParam["content"], string>[number];

type MediaBlock = Extract<ContentBlock, { readonly type: "text" | "image" }>;

type StreamEvent = SDKPartialAssistantMessage["event"];

/** One Claude Code query, held open across Nyte requests while Nyte runs the tools it called. */
type Turn = {
  readonly run: Query;
  /** The Nyte session whose run it serves; that run ending closes it. */
  readonly session: string | undefined;
  /** The model, reasoning, prompt and tools it started with; a request that differs starts a new query. */
  readonly key: string;
  /** Tool results by tool use id, settled by Nyte and awaited by the query's tool calls. */
  readonly results: Map<string, PromiseWithResolvers<CallToolResult>>;
  timer?: ReturnType<typeof setTimeout>;
};

const PROVIDER = "claude-sdk";

const API = "claude-agent-sdk";

const SERVER = "nyte";

const TOOL_PREFIX = `mcp__${SERVER}__`;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly EffortLevel[];

const IDLE_MS = 10 * 60_000;

/** Open queries by the tool use ids they wait on, shared by every provider this module returns. */
const parked = new Map<string, Turn>();

/**
 * Returns the `claude-sdk` provider: Claude models answered through the
 * Claude Agent SDK, on the Claude Code login of this machine. Registered
 * under its own id, it sits beside the `anthropic` provider; registered as
 * `anthropic`, it would replace it.
 *
 * Nyte keeps the agent loop. Claude Code gets Nyte's system prompt and tools
 * and none of its own. When Claude calls tools, its query stays open and the
 * calls wait; the next request that carries their results settles them, and
 * the query goes on. A request that does not continue an open query starts a
 * new one, replaying the transcript as a resumed session.
 *
 * @category plugins
 * @since 0.1.0
 */
export function claudeSdkProvider(): Provider {
  const catalog = anthropicProvider();

  return {
    id: PROVIDER,
    name: "Claude Code",
    auth: {
      apiKey: {
        name: "Claude Code login",
        resolve: async () => ({ auth: {}, source: "Claude Code" }),
      },
    },
    getModels: () =>
      catalog.getModels().map((model) => ({ ...model, provider: PROVIDER, api: API })),
    refreshModels: async (context) => {
      await catalog.refreshModels?.(context);
    },
    stream: (model, context, options) =>
      respond(model, context, options?.signal, undefined, options?.sessionId),
    streamSimple: (model, context, options) =>
      respond(model, context, options?.signal, options?.reasoning, options?.sessionId),
  };
}

function respond(
  model: Model<Api>,
  context: TranscriptContext,
  signal: AbortSignal | undefined,
  reasoning: ThinkingLevel | undefined,
  session: string | undefined,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };

  const key = JSON.stringify([
    model.id,
    reasoning ?? null,
    getCurrentSystemPrompt(context.messages),
    getCurrentTools(context.messages),
  ]);

  let turn: Turn | undefined;
  const stop = () => release(turn);
  signal?.addEventListener("abort", stop, { once: true });

  void (async () => {
    try {
      turn =
        resumeTurn(context.messages, key) ?? startTurn(model, context, reasoning, key, session);

      if (signal?.aborted) throw new Error("Request was aborted");

      stream.push({ type: "start", partial: output });
      const blocks = new Map<number, { readonly index: number; json: string }>();

      for (;;) {
        const next = await turn.run.next();

        if (next.done === true) break;

        if (next.value.type !== "stream_event") continue;
        const event = next.value.event;

        if (event.type === "message_stop") break;
        apply(event, output, blocks, stream, model);
      }

      if (signal?.aborted) throw new Error("Request was aborted");

      if (output.stopReason === "pending") throw new Error("Claude Code ended without a response.");

      if (output.stopReason === "error" || output.stopReason === "aborted")
        throw new Error(output.errorMessage ?? "Claude Code failed.");

      if (output.stopReason === "toolUse") park(turn, output);
      else release(turn);

      stream.push({ type: "done", reason: output.stopReason, message: output });
    } catch (error) {
      release(turn);
      output.stopReason = signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
    } finally {
      signal?.removeEventListener("abort", stop);
      stream.end();
    }
  })();

  return stream;
}

/**
 * Returns the open query whose tool calls the transcript now answers, with
 * their results settled; undefined when the transcript does not end with the
 * results of exactly those calls under the same key, which closes that query.
 */
function resumeTurn(messages: readonly Message[], key: string): Turn | undefined {
  const conversation = messages.filter((message) => message.role !== "system");
  const index = conversation.findLastIndex((message) => message.role === "assistant");
  const assistant = conversation[index];

  if (assistant?.role !== "assistant") return undefined;
  const calls = assistant.content.filter((block) => block.type === "toolCall");
  const turn = parked.get(calls[0]?.id ?? "");

  if (turn === undefined) return undefined;
  const results = conversation.slice(index + 1);

  const answered =
    turn.key === key &&
    results.length === calls.length &&
    results.every(
      (message) => message.role === "toolResult" && parked.get(message.toolCallId) === turn,
    );

  if (!answered) {
    release(turn);

    return undefined;
  }

  clearTimeout(turn.timer);

  for (const message of results) {
    if (message.role !== "toolResult") continue;
    parked.delete(message.toolCallId);
    pending(turn.results, message.toolCallId).resolve(toCallToolResult(message));
  }

  return turn;
}

/**
 * Starts a query for the transcript's last turn: earlier turns are replayed as
 * a resumed session and the last user turn is the prompt. Tool results that
 * end the transcript are replayed too, and the prompt then asks Claude to
 * continue; Claude Code inserts an empty assistant turn before it.
 */
function startTurn(
  model: Model<Api>,
  context: TranscriptContext,
  reasoning: ThinkingLevel | undefined,
  key: string,
  session: string | undefined,
): Turn {
  const params = toParams(context.messages, model);
  const last = params.at(-1);

  if (last?.role !== "user") throw new Error("The transcript has no user turn to answer.");

  const content: ContentBlock[] = Array.isArray(last.content)
    ? last.content
    : [{ type: "text", text: last.content }];

  const answered = content.filter((block) => block.type === "tool_result");
  const prompt = content.filter((block) => block.type !== "tool_result");
  const earlier = params.slice(0, -1);

  if (answered.length > 0) earlier.push({ role: "user", content: answered });

  if (prompt.length === 0) prompt.push({ type: "text", text: "Continue from the tool results." });
  const results = new Map<string, PromiseWithResolvers<CallToolResult>>();

  const run = query({
    prompt: once({
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
    }),
    options: queryOptions(model, context, reasoning, earlier, results),
  });

  return { run, session, key, results };
}

/** Holds a query that stopped on tool calls until Nyte answers them, closing it after `IDLE_MS`. */
function park(turn: Turn, output: AssistantMessage): void {
  for (const block of output.content) if (block.type === "toolCall") parked.set(block.id, turn);
  turn.timer = setTimeout(() => release(turn), IDLE_MS);
  turn.timer.unref();
}

/** Closes the queries a session's run left open on tool calls. */
export function releaseSession(session: string): void {
  for (const turn of parked.values()) if (turn.session === session) release(turn);
}

/** Closes a query and forgets the tool calls it waits on. */
function release(turn: Turn | undefined): void {
  if (turn === undefined) return;
  clearTimeout(turn.timer);

  for (const [id, held] of parked) if (held === turn) parked.delete(id);
  turn.run.close();
}

/** Returns the result a tool call waits on, made by whichever side asks first. */
function pending(results: Turn["results"], id: string): PromiseWithResolvers<CallToolResult> {
  const known = results.get(id);

  if (known !== undefined) return known;
  const created = Promise.withResolvers<CallToolResult>();
  results.set(id, created);

  return created;
}

function toCallToolResult(message: ToolResultMessage): CallToolResult {
  return {
    content: message.content.map((content) =>
      content.type === "text"
        ? { type: "text", text: content.text }
        : { type: "image", data: content.data, mimeType: content.mimeType },
    ),
    isError: message.isError,
  };
}

/**
 * Returns a query's options: Nyte's system prompt and tools, none of Claude
 * Code's own tools, settings or MCP servers, and the earlier turns replayed as
 * a resumed session.
 */
function queryOptions(
  model: Model<Api>,
  context: TranscriptContext,
  reasoning: ThinkingLevel | undefined,
  earlier: readonly MessageParam[],
  results: Turn["results"],
): Options {
  const options: Options = {
    model: model.id,
    systemPrompt: getCurrentSystemPrompt(context.messages),
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    verbatimPrompts: true,
    includePartialMessages: true,
    canUseTool: async (_name, input, { mcpServer }) =>
      mcpServer?.name === SERVER && mcpServer.source === "sdk"
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "Only Nyte's tools run here." },
    ...thinkingOptions(model, reasoning),
  };

  const tools = getCurrentTools(context.messages);

  if (tools.length > 0)
    options.mcpServers = {
      [SERVER]: { type: "sdk", name: SERVER, instance: toolServer(tools, results) },
    };

  if (earlier.length === 0) {
    options.persistSession = false;
    options.title = "Nyte";

    return options;
  }

  const session = randomUUID();
  const history = toEntries(earlier, session, model);
  options.resume = session;

  options.sessionStore = {
    append: async () => undefined,
    load: async (key) => (key.sessionId === session ? history : null),
  };

  return options;
}

function apply(
  event: StreamEvent,
  output: AssistantMessage,
  blocks: Map<number, { readonly index: number; json: string }>,
  stream: AssistantMessageEventStream,
  model: Model<Api>,
): void {
  if (event.type === "message_start") {
    output.responseId = event.message.id;

    if (event.message.model !== model.id) output.responseModel = event.message.model;
    output.usage.input = event.message.usage.input_tokens;
    output.usage.output = event.message.usage.output_tokens;
    output.usage.cacheRead = event.message.usage.cache_read_input_tokens ?? 0;
    output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens ?? 0;
    output.usage.cacheWrite1h = event.message.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  } else if (event.type === "content_block_start") {
    const block = event.content_block;

    const content: TextContent | ThinkingContent | ToolCall | undefined =
      block.type === "text"
        ? { type: "text", text: block.text }
        : block.type === "thinking"
          ? { type: "thinking", thinking: block.thinking, thinkingSignature: block.signature }
          : block.type === "redacted_thinking"
            ? {
                type: "thinking",
                thinking: "[Reasoning redacted]",
                thinkingSignature: block.data,
                redacted: true,
              }
            : block.type === "tool_use"
              ? {
                  type: "toolCall",
                  id: block.id,
                  name: block.name.startsWith(TOOL_PREFIX)
                    ? block.name.slice(TOOL_PREFIX.length)
                    : block.name,
                  arguments: {},
                }
              : undefined;

    if (content === undefined) return;
    const index = output.content.push(content) - 1;
    blocks.set(event.index, { index, json: "" });

    stream.push({
      type:
        content.type === "text"
          ? "text_start"
          : content.type === "thinking"
            ? "thinking_start"
            : "toolcall_start",
      contentIndex: index,
      partial: output,
    });
  } else if (event.type === "content_block_delta") {
    const slot = blocks.get(event.index);

    if (slot === undefined) return;
    const content = output.content[slot.index];
    const delta = event.delta;

    if (delta.type === "text_delta" && content.type === "text") {
      content.text += delta.text;
      stream.push({
        type: "text_delta",
        contentIndex: slot.index,
        delta: delta.text,
        partial: output,
      });
    } else if (delta.type === "thinking_delta" && content.type === "thinking") {
      content.thinking += delta.thinking;
      stream.push({
        type: "thinking_delta",
        contentIndex: slot.index,
        delta: delta.thinking,
        partial: output,
      });
    } else if (delta.type === "signature_delta" && content.type === "thinking") {
      content.thinkingSignature = (content.thinkingSignature ?? "") + delta.signature;
    } else if (delta.type === "input_json_delta" && content.type === "toolCall") {
      slot.json += delta.partial_json;
      content.arguments = parseStreamingJson(slot.json);
      stream.push({
        type: "toolcall_delta",
        contentIndex: slot.index,
        delta: delta.partial_json,
        partial: output,
      });
    }
  } else if (event.type === "content_block_stop") {
    const slot = blocks.get(event.index);

    if (slot === undefined) return;
    blocks.delete(event.index);
    const content = output.content[slot.index];

    if (content.type === "text")
      stream.push({
        type: "text_end",
        contentIndex: slot.index,
        content: content.text,
        partial: output,
      });
    else if (content.type === "thinking")
      stream.push({
        type: "thinking_end",
        contentIndex: slot.index,
        content: content.thinking,
        partial: output,
      });
    else
      stream.push({
        type: "toolcall_end",
        contentIndex: slot.index,
        toolCall: content,
        partial: output,
      });
  } else if (event.type === "message_delta") {
    const reason = event.delta.stop_reason;

    if (reason !== null) {
      output.rawStopReason = reason;
      output.stopReason =
        reason === "tool_use"
          ? "toolUse"
          : reason === "max_tokens" || reason === "model_context_window_exceeded"
            ? "length"
            : reason === "refusal"
              ? "error"
              : "stop";

      if (reason === "refusal") output.errorMessage = "The model refused to complete the request.";
    }

    output.usage.input = event.usage.input_tokens ?? output.usage.input;
    output.usage.output = event.usage.output_tokens;
    output.usage.cacheRead = event.usage.cache_read_input_tokens ?? output.usage.cacheRead;
    output.usage.cacheWrite = event.usage.cache_creation_input_tokens ?? output.usage.cacheWrite;
  }

  output.usage.totalTokens =
    output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
  calculateCost(model, output.usage);
}

/**
 * Converts the transcript to alternating Messages API turns: failed assistant
 * turns are dropped, a tool call left without a result gets an error result,
 * and Nyte's tool names carry the MCP prefix Claude Code declares them under.
 */
function toParams(messages: readonly Message[], model: Model<Api>): MessageParam[] {
  const params: MessageParam[] = [];
  let unanswered = new Map<string, string>();

  const push = (role: MessageParam["role"], content: readonly ContentBlock[]) => {
    if (content.length === 0) return;
    const last = params.at(-1);

    if (last?.role === role && Array.isArray(last.content)) last.content.push(...content);
    else params.push({ role, content: [...content] });
  };

  const closeToolCalls = () => {
    push(
      "user",
      [...unanswered].map(([id]) => ({
        type: "tool_result",
        tool_use_id: id,
        content: "No result provided",
        is_error: true,
      })),
    );

    unanswered = new Map();
  };

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "toolResult") {
      const id = toolUseId(message.toolCallId);
      unanswered.delete(id);
      push("user", [
        {
          type: "tool_result",
          tool_use_id: id,
          content: message.content.map(toBlock),
          is_error: message.isError,
        },
      ]);
      continue;
    }

    closeToolCalls();

    if (message.role === "user") {
      push(
        "user",
        Array.isArray(message.content)
          ? message.content.map(toBlock)
          : [{ type: "text", text: message.content }],
      );
      continue;
    }

    if (message.stopReason === "error" || message.stopReason === "aborted") continue;
    const replayable = message.provider === model.provider && message.model === model.id;

    push(
      "assistant",
      message.content.flatMap((block): ContentBlock[] => {
        if (block.type === "toolCall") {
          const id = toolUseId(block.id);
          unanswered.set(id, block.name);

          return [
            { type: "tool_use", id, name: `${TOOL_PREFIX}${block.name}`, input: block.arguments },
          ];
        }

        if (block.type === "text")
          return block.text.trim().length === 0 ? [] : [{ type: "text", text: block.text }];

        if (replayable && block.redacted === true && block.thinkingSignature !== undefined)
          return [{ type: "redacted_thinking", data: block.thinkingSignature }];

        if (replayable && block.thinkingSignature !== undefined && block.thinkingSignature !== "")
          return [
            { type: "thinking", thinking: block.thinking, signature: block.thinkingSignature },
          ];

        return block.redacted === true || block.thinking.trim().length === 0
          ? []
          : [{ type: "text", text: block.thinking }];
      }),
    );
  }

  closeToolCalls();

  return params.map((param) =>
    param.role === "user" && Array.isArray(param.content)
      ? {
          ...param,
          content: [
            ...param.content.filter((block) => block.type === "tool_result"),
            ...param.content.filter((block) => block.type !== "tool_result"),
          ],
        }
      : param,
  );
}

function toBlock(content: TextContent | ImageContent): MediaBlock {
  if (content.type === "text") return { type: "text", text: content.text };
  const mediaType = IMAGE_TYPES.find((type) => type === content.mimeType);

  return mediaType === undefined
    ? { type: "text", text: `(${content.mimeType} image omitted)` }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: content.data } };
}

/** Returns a tool call id the Messages API accepts; the same id maps the same way on both sides. */
function toolUseId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/** Returns the earlier turns as Claude Code session entries, which `resume` replays. */
function toEntries(
  params: readonly MessageParam[],
  session: string,
  model: Model<Api>,
): SessionStoreEntry[] {
  const cwd = process.cwd();
  const timestamp = new Date().toISOString();
  let parentUuid: string | null = null;

  return params.map((param) => {
    const uuid = randomUUID();

    const entry: SessionStoreEntry = {
      type: param.role,
      uuid,
      parentUuid,
      sessionId: session,
      timestamp,
      isSidechain: false,
      userType: "external",
      cwd,
      message:
        param.role === "user"
          ? param
          : {
              id: `msg_${uuid.replaceAll("-", "")}`,
              type: "message",
              role: "assistant",
              model: model.id,
              content: param.content,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
    };

    parentUuid = uuid;

    return entry;
  });
}

/** Declares Nyte's tools with their own JSON Schema; each call waits for the result Nyte sends for its tool use id. */
function toolServer(tools: readonly Tool[], results: Turn["results"]): McpServer {
  const server = new McpServer({ name: SERVER, version: "1.0.0" }, { capabilities: { tools: {} } });

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { ...tool.parameters, type: "object" },
    })),
  }));

  server.server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { _meta: meta } = request.params;

    return pending(results, String(meta?.["claudecode/toolUseId"])).promise;
  });

  return server;
}

function thinkingOptions(
  model: Model<Api>,
  reasoning: ThinkingLevel | undefined,
): Pick<Options, "thinking" | "effort"> {
  const level = reasoning === undefined ? "off" : clampThinkingLevel(model, reasoning);

  if (level === "off") return { thinking: { type: "disabled" } };

  if (model.thinkingLevelMap === undefined)
    return { thinking: { type: "enabled", display: "summarized" } };
  const mapped = model.thinkingLevelMap[level] ?? level;

  return {
    thinking: { type: "adaptive", display: "summarized" },
    effort: EFFORTS.find((effort) => effort === mapped) ?? "high",
  };
}

async function* once(message: SDKUserMessage): AsyncGenerator<SDKUserMessage> {
  yield message;
}
