import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  EffortLevel,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SessionKey,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { Api, AssistantMessageEventStream, Model } from "@nyte-ai/ai";
import type { ContentBlock } from "./transcript.ts";
import { BACKGROUND_TOOL, emptyMessage, mirrorCall, Translator } from "./translate.ts";

export interface Launch {
  readonly key: string;
  readonly model: string;
  readonly cwd: string;
  readonly thinking: boolean;
  readonly effort: EffortLevel | undefined;
  readonly ultracode: boolean;
  readonly env: Record<string, string | undefined> | undefined;
  readonly session: string;
  readonly history: readonly SessionStoreEntry[];
}

export type QuestionAnswers = Record<string, string> | null;

export interface ClaudeToolOutput {
  readonly text: string;
  readonly isError: boolean;
}

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
  readonly #query: Query;
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
    const session = launch.session;

    const options: Options = {
      model: launch.model,
      cwd: launch.cwd,
      systemPrompt: { type: "preset", preset: "claude_code" },
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      canUseTool: async (name, input, { signal, toolUseID, agentID }) => {
        if (name !== "AskUserQuestion") return { behavior: "allow", updatedInput: input };

        if (agentID !== undefined)
          return { behavior: "deny", message: "Only the main agent can ask the user questions." };
        const answers = await this.#question(toolUseID, signal);

        return answers === null
          ? { behavior: "deny", message: "The user did not answer." }
          : { behavior: "allow", updatedInput: { ...input, answers } };
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
    };

    if (launch.effort !== undefined) options.effort = launch.effort;

    if (launch.ultracode) options.settings = { ultracode: true, enableWorkflows: true };

    if (launch.history.length > 0) {
      options.resume = session;
      options.sessionStore = memoryStore(session, launch.history);
    }

    this.#query = query({ prompt: this.#prompts, options });
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

          if (stop === "tool_use") break;

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

  #changed(): void {
    for (const change of this.#changes) change();
  }
}
