import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type {
  EffortLevel,
  McpSdkServerConfigWithInstance,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SdkMcpToolDefinition,
  SessionKey,
  SessionStoreEntry,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type {
  Api,
  AssistantMessageEventStream,
  Message,
  Model,
  ProviderEnv,
  Tool,
} from "@nyte-ai/ai";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ContentBlock } from "./transcript.ts";
import { messageKey } from "./transcript.ts";
import { emptyMessage, NYTE_SERVER, NYTE_TOOL_PREFIX, Translator } from "./translate.ts";

interface Launch {
  /** What only a new process can change: model, folder, thinking and system prompt. Effort and tools change on a running one. */
  readonly key: string;
  readonly model: string;
  readonly cwd: string;
  readonly system: string;
  readonly thinking: boolean;
  readonly effort: EffortLevel | undefined;
  readonly env: ProviderEnv | undefined;
  readonly session: string;
  readonly history: readonly SessionStoreEntry[];
  readonly tools: readonly Tool[];
  readonly query: StartQuery;
  /** The installed `claude` to run; without one the Agent SDK looks for its own. */
  readonly claude: string | undefined;
}

/** Starts Claude Code: the Agent SDK's `query`, or a stand-in with the parts of its `Query` a session uses. */
export type StartQuery = (
  params: Parameters<typeof query>[0],
) => AsyncIterable<SDKMessage> & Pick<Query, "applyFlagSettings" | "close">;

type ToolReply = Awaited<ReturnType<SdkMcpToolDefinition["handler"]>>;

const toolUseId = Type.String({ minLength: 1 });

/** Claude Code features with a Nyte counterpart, or that would act outside Nyte's sight. */
const ISOLATION_ENV = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  DISABLE_AUTO_COMPACT: "1",
  CLAUDE_CODE_ENABLE_AWAY_SUMMARY: "0",
  // Tool search would hide every Nyte tool, since they all reach Claude through MCP.
  ENABLE_TOOL_SEARCH: "false",
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
  // Nyte truncates tool output itself.
  MAX_MCP_OUTPUT_TOKENS: "200000",
  // Skips the subscription login.
  CLAUDE_CODE_SIMPLE: undefined,
  // Overrides the effort Nyte picks.
  CLAUDE_CODE_EFFORT_LEVEL: undefined,
  // Would fail any Nyte tool call that waits on the user longer.
  MCP_TOOL_TIMEOUT: undefined,
};

/**
 * Claude Code as a bare model: only the tools and system prompt Nyte passes, none of the user's
 * Claude Code settings, hooks, MCP servers, skills or CLAUDE.md, and prompts sent as written
 * (`verbatimPrompts` needs Claude Code 2.1.248 or later).
 */
export function isolatedOptions(claude: string | undefined, env: ProviderEnv | undefined): Options {
  return {
    pathToClaudeCodeExecutable: claude,
    env: { ...process.env, ...env, CLAUDE_AGENT_SDK_CLIENT_APP: "nyte", ...ISOLATION_ENV },
    tools: [],
    settingSources: [],
    settings: { disableAllHooks: true },
    strictMcpConfig: true,
    skills: [],
    permissionMode: "dontAsk",
    verbatimPrompts: true,
  };
}

type TurnItem = Extract<SDKMessage, { type: "stream_event" | "result" | "assistant" }>;

class Inbox<T> {
  readonly #items: T[] = [];
  #waiter: (() => void) | undefined;
  #ended = false;

  push(item: T): void {
    this.#items.push(item);
    this.#wake();
  }

  clear(): void {
    this.#items.length = 0;
  }

  end(): void {
    this.#ended = true;
    this.#wake();
  }

  async next(): Promise<T | undefined> {
    while (this.#items.length === 0 && !this.#ended)
      await new Promise<void>((resolve) => (this.#waiter = resolve));

    return this.#items.shift();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      const item = await this.next();

      if (item === undefined) return;
      yield item;
    }
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

function toolError(text: string): ToolReply {
  return { content: [{ type: "text", text }], isError: true };
}

function reply(message: Extract<Message, { readonly role: "toolResult" }>): ToolReply {
  return {
    content: message.content.map((block) =>
      block.type === "text"
        ? { type: "text", text: block.text }
        : { type: "image", data: block.data, mimeType: block.mimeType },
    ),
    isError: message.isError,
  };
}

function storePath(key: SessionKey): string {
  return key.subpath === undefined ? key.sessionId : `${key.sessionId}/${key.subpath}`;
}

function memoryStore(session: string, history: readonly SessionStoreEntry[]) {
  const files = new Map<string, SessionStoreEntry[]>([[session, [...history]]]);

  return {
    append: async (key: SessionKey, entries: SessionStoreEntry[]) => {
      files.set(storePath(key), [...(files.get(storePath(key)) ?? []), ...entries]);
    },
    load: async (key: SessionKey) => files.get(storePath(key)) ?? null,
  };
}

/**
 * One running `claude` for a Nyte session. Claude's calls to Nyte's tools end the response that
 * makes them; Nyte runs them like any model's calls, and their results answer Claude's MCP
 * requests when the next response starts.
 */
export class ClaudeCodeSession {
  readonly #key: string;
  /** Message keys of the transcript Claude has seen, up to its last reply. */
  #known: readonly string[] = [];

  readonly #prompts = new Inbox<SDKUserMessage>();
  readonly #turn = new Inbox<TurnItem>();
  readonly #replies = new Map<string, PromiseWithResolvers<ToolReply>>();
  readonly #server: McpSdkServerConfigWithInstance;
  readonly #query: ReturnType<StartQuery>;
  #tools: readonly Tool[];
  #effort: EffortLevel | undefined;
  #idle = true;
  #stderr = "";
  #failure: Error | undefined;

  constructor(launch: Launch) {
    this.#key = launch.key;
    this.#effort = launch.effort;
    this.#tools = launch.tools;
    this.#server = createSdkMcpServer({ name: NYTE_SERVER, tools: [] });
    this.#server.instance.server.registerCapabilities({ tools: { listChanged: true } });

    this.#server.instance.server.fallbackRequestHandler = async (request, extra) => {
      if (request.method === "tools/list")
        return {
          tools: this.#tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: { ...tool.parameters, type: "object" },
          })),
        };

      if (request.method !== "tools/call")
        throw new Error(`Nyte does not serve ${request.method}.`);
      const { _meta: meta } = extra;
      const id = meta?.["claudecode/toolUseId"];

      return Value.Check(toolUseId, id)
        ? await this.#call(id, extra.signal)
        : toolError("Claude Code sent no tool use id for this Nyte tool call.");
    };

    const options: Options = {
      ...isolatedOptions(launch.claude, launch.env),
      model: launch.model,
      cwd: launch.cwd,
      systemPrompt: { type: "custom", prompt: launch.system },
      includePartialMessages: true,
      mcpServers: { [NYTE_SERVER]: this.#server },
      allowedTools: [`${NYTE_TOOL_PREFIX}*`],
      thinking: launch.thinking
        ? { type: "adaptive", display: "summarized" }
        : { type: "disabled" },
      stderr: (chunk) => (this.#stderr = (this.#stderr + chunk).slice(-4_096)),
    };

    if (launch.effort !== undefined) options.effort = launch.effort;

    if (launch.history.length > 0) {
      options.resume = launch.session;
      options.sessionStore = memoryStore(launch.session, launch.history);
    }

    this.#query = launch.query({ prompt: this.#prompts, options });
    void this.#pump();
  }

  get closed(): boolean {
    return this.#failure !== undefined;
  }

  /** Whether this process can take the turn for `keys`: it was launched as `key` and has seen their start. */
  follows(key: string, keys: readonly string[]): boolean {
    return (
      !this.closed &&
      this.#key === key &&
      this.#known.length < keys.length &&
      this.#known.every((known, index) => keys[index] === known)
    );
  }

  async configure(effort: EffortLevel | undefined): Promise<void> {
    if (this.#effort === effort) return;
    this.#effort = effort;
    await this.#query.applyFlagSettings({ effortLevel: effort ?? null });
  }

  /** Serves `tools` as the Nyte MCP server's tools from now on, telling Claude Code when they changed. */
  expose(tools: readonly Tool[]): void {
    if (JSON.stringify(tools) === JSON.stringify(this.#tools)) return;
    this.#tools = tools;
    this.#server.instance.sendToolListChanged();
  }

  /** Answers Claude's waiting Nyte tool calls with the results Nyte recorded for them. */
  deliver(messages: readonly Message[]): void {
    for (const message of messages)
      if (message.role === "toolResult")
        this.#replies.get(message.toolCallId)?.resolve(reply(message));
  }

  send(content: readonly ContentBlock[]): void {
    if (this.#idle) this.#turn.clear();
    this.#idle = false;
    this.#prompts.push({
      type: "user",
      message: { role: "user", content: [...content] },
      parent_tool_use_id: null,
      origin: { kind: "human" },
    });
  }

  /** Streams Claude's next response to the transcript whose message keys are `keys`. */
  respond(
    model: Model<Api>,
    keys: readonly string[],
    signal: AbortSignal | undefined,
  ): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();
    const output = emptyMessage(model);
    const translator = new Translator(model, output, stream);
    const abort = () => this.close(new Error("Request was aborted"));
    signal?.addEventListener("abort", abort, { once: true });

    void (async () => {
      try {
        stream.push({ type: "start", partial: output });
        let failure: string | undefined;

        for (;;) {
          const item = await this.#turn.next();

          if (item === undefined) throw this.#failure ?? new Error("Claude Code exited.");

          if (item.type === "assistant") {
            if (item.error !== undefined)
              failure = item.message.content
                .flatMap((block) => (block.type === "text" ? [block.text] : []))
                .join("\n");

            continue;
          }

          if (item.type === "result") {
            if (item.subtype !== "success")
              throw new Error(
                failure ?? (item.errors.join("\n") || `Claude Code failed: ${item.subtype}`),
              );

            if (item.is_error) throw new Error(failure ?? item.result);

            this.#idle = true;

            if (output.stopReason === "pending") output.stopReason = "stop";
            break;
          }

          if (
            translator.apply(item.event) === "tool_use" &&
            output.content.some((block) => block.type === "toolCall")
          )
            break;
        }

        if (output.stopReason === "error")
          throw new Error(output.errorMessage ?? "Claude Code failed.");

        if (output.stopReason === "aborted" || output.stopReason === "pending")
          throw new Error("Claude Code ended without a response.");

        this.#known = [...keys, messageKey(output)];
        stream.push({ type: "done", reason: output.stopReason, message: output });
      } catch (error) {
        output.stopReason = signal?.aborted === true ? "aborted" : "error";
        output.errorMessage = error instanceof Error ? error.message : String(error);
        stream.push({ type: "error", reason: output.stopReason, error: output });
        this.close(error instanceof Error ? error : new Error(String(error)));
      } finally {
        signal?.removeEventListener("abort", abort);
        stream.end();
      }
    })();

    return stream;
  }

  close(reason: Error = new Error("Claude Code closed.")): void {
    if (this.#failure !== undefined) return;
    this.#failure = reason;

    for (const pending of this.#replies.values()) pending.resolve(toolError(reason.message));
    this.#prompts.end();
    this.#turn.end();
    this.#query.close();
  }

  #reply(id: string): PromiseWithResolvers<ToolReply> {
    const known = this.#replies.get(id);

    if (known !== undefined) return known;
    const created = Promise.withResolvers<ToolReply>();
    this.#replies.set(id, created);

    return created;
  }

  async #call(id: string, signal: AbortSignal): Promise<ToolReply> {
    const pending = this.#reply(id);
    const cancel = () => pending.resolve(toolError("Request was aborted"));
    signal.addEventListener("abort", cancel, { once: true });

    try {
      return await pending.promise;
    } finally {
      this.#replies.delete(id);
      signal.removeEventListener("abort", cancel);
    }
  }

  async #pump(): Promise<void> {
    try {
      for await (const message of this.#query) this.#route(message);
      this.close(new Error(`Claude Code exited.${this.#detail()}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.close(new Error(`${message}${this.#detail()}`, { cause: error }));
    }
  }

  #detail(): string {
    const tail = this.#stderr.trim().slice(-500);

    return tail === "" ? "" : ` (${tail})`;
  }

  /** Queues the main agent's messages for the turn. A Nyte call's reply waits from the call's start, since its result can reach Nyte before Claude Code asks for it. */
  #route(message: SDKMessage): void {
    if (message.type === "result") {
      this.#turn.push(message);

      return;
    }

    if (
      (message.type !== "stream_event" && message.type !== "assistant") ||
      message.parent_tool_use_id !== null
    )
      return;

    if (
      message.type === "stream_event" &&
      message.event.type === "content_block_start" &&
      message.event.content_block.type === "tool_use" &&
      message.event.content_block.name.startsWith(NYTE_TOOL_PREFIX)
    )
      this.#reply(message.event.content_block.id);
    this.#turn.push(message);
  }
}
