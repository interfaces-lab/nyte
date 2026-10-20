import { randomUUID } from "node:crypto";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type {
  CanUseTool,
  EffortLevel,
  HookInput,
  HookJSONOutput,
  McpSdkServerConfigWithInstance,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
  SdkMcpToolDefinition,
  SessionKey,
  SessionStoreEntry,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { Api, AssistantMessageEventStream, Message, Model, Tool } from "@nyte-ai/ai";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ContentBlock } from "./transcript.ts";
import {
  BACKGROUND_TOOL,
  emptyMessage,
  mirrorCall,
  NYTE_SERVER,
  NYTE_TOOL_PREFIX,
  Translator,
} from "./translate.ts";

interface Launch {
  readonly key: string;
  readonly model: string;
  readonly cwd: string;
  readonly thinking: boolean;
  readonly effort: EffortLevel | undefined;
  readonly ultracode: boolean;
  readonly env: Record<string, string | undefined> | undefined;
  readonly session: string;
  readonly history: readonly SessionStoreEntry[];
  readonly tools: readonly Tool[];
  readonly query: StartQuery;
  /** The installed `claude` to run; without one the Agent SDK looks for its own. */
  readonly claude: string | undefined;
  readonly approve: Approve;
}

/** Decides a call Claude Code asks to run under Nyte's permissions policy, by the tool's own name. */
export type Approve = (
  name: string,
  input: Parameters<CanUseTool>[1],
  signal: AbortSignal,
) => Promise<PermissionResult>;

/** Starts Claude Code: the Agent SDK's `query`, or a stand-in with the parts of its `Query` a session uses. */
export type StartQuery = (
  params: Parameters<typeof query>[0],
) => AsyncIterable<SDKMessage> & Pick<Query, "applyFlagSettings" | "close">;

export type QuestionAnswers = Record<string, string> | null;

interface ClaudeToolOutput {
  readonly text: string;
  readonly isError: boolean;
}

type ToolReply = Awaited<ReturnType<SdkMcpToolDefinition["handler"]>>;

const ALLOW: PermissionResult = { behavior: "allow" };

const SKIPPED = "Nyte did not run this tool call.";

const toolUseId = Type.String({ minLength: 1 });

const toolInput = Type.Record(Type.String(), Type.Unknown());

/** How long Claude Code waits on the PreToolUse hook, which holds a call while the user decides it: a week, so a hook timeout never lets a call past Nyte's policy. */
const APPROVAL_HOOK_SECONDS = 7 * 24 * 60 * 60;

type TurnItem =
  | Extract<SDKMessage, { type: "stream_event" | "result" | "assistant" }>
  | Extract<SDKMessage, { subtype: "session_state_changed" }>;

class Inbox<T> {
  readonly #items: T[] = [];
  #waiter: (() => void) | undefined;
  #ended = false;

  has(match: (item: T) => boolean): boolean {
    return this.#items.some(match);
  }

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

type ToolResultBlock = Extract<ContentBlock, { readonly type: "tool_result" }>;

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

function resultText(content: ToolResultBlock["content"]): string {
  if (!Array.isArray(content)) return content ?? "";

  return content
    .map((block) => (block.type === "text" ? block.text : `[${block.type} content]`))
    .join("\n");
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

export class ClaudeCodeSession {
  readonly key: string;
  known: readonly string[] = [];

  readonly #prompts = new Inbox<SDKUserMessage>();
  readonly #turn = new Inbox<TurnItem>();
  readonly #results = new Map<string, ClaudeToolOutput>();
  readonly #questions = new Map<string, PromiseWithResolvers<QuestionAnswers>>();
  readonly #asking = new Set<string>();
  readonly #changes = new Set<() => void>();
  readonly #replies = new Map<string, PromiseWithResolvers<ToolReply>>();
  readonly #gates = new Map<string, PromiseWithResolvers<PermissionResult>>();
  readonly #permits = new Map<string, Promise<PermissionResult>>();
  readonly #approve: Approve;
  readonly #server: McpSdkServerConfigWithInstance;
  readonly #query: ReturnType<StartQuery>;
  #tools: readonly Tool[];
  #order: string[] = [];
  #settings: { readonly effort: EffortLevel | undefined; readonly ultracode: boolean };
  #background: readonly string[] = [];
  #notes: string[] = [];
  #idle = true;
  #held = false;
  #stderr = "";
  #failure: Error | undefined;

  constructor(launch: Launch) {
    this.key = launch.key;
    this.#settings = { effort: launch.effort, ultracode: launch.ultracode };
    this.#tools = launch.tools;
    this.#approve = launch.approve;
    const session = launch.session;
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
      model: launch.model,
      cwd: launch.cwd,
      systemPrompt: { type: "preset", preset: "claude_code" },
      includePartialMessages: true,
      mcpServers: { [NYTE_SERVER]: this.#server },
      permissionMode: "default",
      canUseTool: async (name, input, { signal, toolUseID, agentID }) => {
        if (name.startsWith(NYTE_TOOL_PREFIX))
          return agentID === undefined
            ? ALLOW
            : { behavior: "deny", message: "Only the main agent can use Nyte's tools." };

        if (name === "AskUserQuestion") {
          if (agentID !== undefined)
            return { behavior: "deny", message: "Only the main agent can ask the user questions." };
          const answers = await this.#question(toolUseID, signal);

          return answers === null
            ? { behavior: "deny", message: "The user did not answer." }
            : { behavior: "allow", updatedInput: { ...input, answers } };
        }

        return await this.#permit(toolUseID, name, input, agentID === undefined, signal);
      },
      hooks: {
        PreToolUse: [
          {
            hooks: [(input, _id, { signal }) => this.#beforeTool(input, signal)],
            timeout: APPROVAL_HOOK_SECONDS,
          },
        ],
      },
      thinking: launch.thinking
        ? { type: "adaptive", display: "summarized" }
        : { type: "disabled" },
      env: {
        ...process.env,
        ...launch.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "nyte",
        CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
      },
      stderr: (chunk) => (this.#stderr = (this.#stderr + chunk).slice(-4_096)),
      pathToClaudeCodeExecutable: launch.claude,
    };

    if (launch.effort !== undefined) options.effort = launch.effort;

    if (launch.ultracode) options.settings = { ultracode: true, enableWorkflows: true };

    if (launch.history.length > 0) {
      options.resume = session;
      options.sessionStore = memoryStore(session, launch.history);
    }

    this.#query = launch.query({ prompt: this.#prompts, options });
    void this.#pump();
  }

  get closed(): boolean {
    return this.#failure !== undefined;
  }

  async configure(effort: EffortLevel | undefined, ultracode: boolean): Promise<void> {
    if (this.#settings.effort === effort && this.#settings.ultracode === ultracode) return;
    this.#settings = { effort, ultracode };
    await this.#query.applyFlagSettings({
      effortLevel: effort ?? null,
      ultracode: ultracode ? true : null,
      enableWorkflows: ultracode ? true : null,
    });
  }

  /** Serves `tools` as the Nyte MCP server's tools from now on, telling Claude Code when they changed. */
  expose(tools: readonly Tool[]): void {
    if (JSON.stringify(tools) === JSON.stringify(this.#tools)) return;
    this.#tools = tools;
    this.#server.instance.sendToolListChanged();
  }

  /** Answers Claude Code from Nyte's tool results: a Nyte tool call gets its result, and a call Claude Code asked to run but Nyte settled without running it is denied with that result. */
  deliver(messages: readonly Message[]): void {
    for (const message of messages) {
      if (message.role !== "toolResult") continue;
      const id = message.toolCallId;

      if (this.#replies.has(id)) this.#reply(id).resolve(reply(message));
      else
        this.#gates.get(id)?.resolve({
          behavior: "deny",
          message:
            message.content
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join("\n") || SKIPPED,
        });
    }
  }

  /** Lets Claude Code's call `id` go on to its approval now that Nyte records it (so the workspace snapshot before it is taken), and denies the calls before it in the same message that Nyte settled without running. */
  recording(id: string): void {
    const position = this.#order.findIndex((known) => known === id);

    for (const [index, earlier] of this.#order.entries()) {
      if (index > position) break;
      this.#gate(earlier).resolve(
        index === position ? ALLOW : { behavior: "deny", message: SKIPPED },
      );
    }
  }

  send(content: readonly ContentBlock[]): void {
    if (this.#idle) this.#turn.clear();
    this.#idle = false;
    this.#held = false;
    this.#prompts.push({
      type: "user",
      message: { role: "user", content: [...content] },
      parent_tool_use_id: null,
      origin: { kind: "human" },
    });
  }

  respond(model: Model<Api>, signal: AbortSignal | undefined): AssistantMessageEventStream {
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

          if (item.type === "system") {
            if (item.state !== "idle" || !this.#held) continue;
            this.#held = false;
            this.#idle = true;

            if (output.stopReason === "pending") output.stopReason = "stop";
            break;
          }

          if (item.type === "result" && this.#held) continue;

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

          this.#held = false;
          const stop = translator.apply(item.event);

          if (stop === "tool_use") {
            if (output.content.some((block) => block.type === "toolCall")) break;

            continue;
          }

          if (stop !== undefined && this.#background.length > 0) {
            translator.append(
              mirrorCall(`claude-code-background-${randomUUID()}`, BACKGROUND_TOOL, {
                tasks: [...this.#background],
              }),
            );
            output.stopReason = "toolUse";
            this.#held = true;
            break;
          }
        }

        if (output.stopReason === "error")
          throw new Error(output.errorMessage ?? "Claude Code failed.");

        if (output.stopReason === "aborted" || output.stopReason === "pending")
          throw new Error("Claude Code ended without a response.");

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

  get asking(): boolean {
    return this.#asking.size > 0;
  }

  answer(id: string, answers: QuestionAnswers): void {
    this.#pending(id).resolve(answers);
  }

  async result(id: string, signal: AbortSignal): Promise<ClaudeToolOutput> {
    await this.#until(() => this.#results.has(id), signal);
    const output = this.#results.get(id);

    if (output === undefined)
      throw this.#failure ?? new Error("Claude Code is no longer running this turn.");

    return output;
  }

  async background(signal: AbortSignal): Promise<string> {
    await this.#until(
      () => this.#turn.has((item) => item.type === "stream_event" || item.type === "system"),
      signal,
    );

    if (this.#failure !== undefined) throw this.#failure;
    const notes = this.#notes.splice(0);

    return notes.length === 0 ? "Background work finished." : notes.join("\n\n");
  }

  close(reason: Error = new Error("Claude Code closed.")): void {
    if (this.#failure !== undefined) return;
    this.#failure = reason;

    for (const pending of this.#questions.values()) pending.resolve(null);

    for (const pending of this.#replies.values()) pending.resolve(toolError(reason.message));

    for (const pending of this.#gates.values())
      pending.resolve({ behavior: "deny", message: reason.message });
    this.#prompts.end();
    this.#turn.end();
    this.#query.close();
    this.#changed();
  }

  #pending(id: string): PromiseWithResolvers<QuestionAnswers> {
    const known = this.#questions.get(id);

    if (known !== undefined) return known;
    const created = Promise.withResolvers<QuestionAnswers>();
    this.#questions.set(id, created);

    return created;
  }

  async #question(id: string, signal: AbortSignal): Promise<QuestionAnswers> {
    const pending = this.#pending(id);
    const cancel = () => this.answer(id, null);
    this.#asking.add(id);
    signal.addEventListener("abort", cancel, { once: true });

    try {
      return await pending.promise;
    } finally {
      this.#asking.delete(id);
      signal.removeEventListener("abort", cancel);
    }
  }

  #reply(id: string): PromiseWithResolvers<ToolReply> {
    const known = this.#replies.get(id);

    if (known !== undefined) return known;
    const created = Promise.withResolvers<ToolReply>();
    this.#replies.set(id, created);

    return created;
  }

  #gate(id: string): PromiseWithResolvers<PermissionResult> {
    const known = this.#gates.get(id);

    if (known !== undefined) return known;
    const created = Promise.withResolvers<PermissionResult>();
    this.#gates.set(id, created);

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

  /** Decides call `id` once, whichever of the PreToolUse hook and `canUseTool` asks first: a main-agent call waits until Nyte records it, then every call goes to Nyte's policy. */
  #permit(
    id: string,
    name: string,
    input: Record<string, unknown>,
    main: boolean,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const known = this.#permits.get(id);

    if (known !== undefined) return known;

    const decided = (async (): Promise<PermissionResult> => {
      if (main) {
        const recorded = await this.#recorded(id, signal);

        if (recorded.behavior === "deny") return recorded;
      }

      return this.#approve(name, input, signal);
    })();

    this.#permits.set(id, decided);

    return decided;
  }

  async #beforeTool(input: HookInput, signal: AbortSignal): Promise<HookJSONOutput> {
    if (
      input.hook_event_name !== "PreToolUse" ||
      input.tool_name.startsWith(NYTE_TOOL_PREFIX) ||
      input.tool_name === "AskUserQuestion"
    )
      return {};

    const decided = await this.#permit(
      input.tool_use_id,
      input.tool_name,
      Value.Check(toolInput, input.tool_input) ? input.tool_input : {},
      input.agent_id === undefined,
      signal,
    );

    return decided.behavior === "allow"
      ? {}
      : {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decided.message,
          },
        };
  }

  async #recorded(id: string, signal: AbortSignal): Promise<PermissionResult> {
    const pending = this.#gate(id);
    const cancel = () => pending.resolve({ behavior: "deny", message: "Request was aborted" });
    signal.addEventListener("abort", cancel, { once: true });

    try {
      return await pending.promise;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async #until(ready: () => boolean, signal: AbortSignal): Promise<void> {
    while (!ready() && this.#failure === undefined) {
      signal.throwIfAborted();

      await new Promise<void>((resolve) => {
        const done = () => {
          this.#changes.delete(done);
          signal.removeEventListener("abort", done);
          resolve();
        };

        this.#changes.add(done);
        signal.addEventListener("abort", done, { once: true });
      });
    }

    if (signal.aborted) {
      this.close(new Error("Request was aborted"));
      signal.throwIfAborted();
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

  #route(message: SDKMessage): void {
    switch (message.type) {
      case "stream_event":
        if (message.parent_tool_use_id !== null) break;
        this.#track(message.event);
        this.#turn.push(message);
        break;
      case "assistant":
        if (message.parent_tool_use_id === null) this.#turn.push(message);
        break;
      case "result":
        this.#turn.push(message);
        break;
      case "user": {
        const content = message.message.content;

        if (message.parent_tool_use_id !== null || !Array.isArray(content)) break;

        for (const block of content)
          if (block.type === "tool_result")
            this.#results.set(block.tool_use_id, {
              text: resultText(block.content),
              isError: block.is_error === true,
            });

        break;
      }

      case "system":
        if (message.subtype === "background_tasks_changed")
          this.#background = message.tasks.flatMap((task) =>
            task.ambient === true ? [] : [task.description],
          );
        else if (message.subtype === "task_notification") this.#notes.push(message.summary);
        else if (message.subtype === "session_state_changed" && message.state === "idle")
          this.#turn.push(message);
        break;
      default:
        break;
    }

    this.#changed();
  }

  #track(event: Extract<SDKMessage, { type: "stream_event" }>["event"]): void {
    if (event.type === "message_start") {
      for (const id of this.#order) {
        this.#gates.delete(id);
        this.#permits.delete(id);
      }

      this.#order = [];

      return;
    }

    if (event.type !== "content_block_start" || event.content_block.type !== "tool_use") return;
    const id = event.content_block.id;

    if (event.content_block.name.startsWith(NYTE_TOOL_PREFIX)) {
      this.#reply(id);

      return;
    }

    this.#order.push(id);
    this.#gate(id);
  }

  #changed(): void {
    for (const change of this.#changes) change();
  }
}
