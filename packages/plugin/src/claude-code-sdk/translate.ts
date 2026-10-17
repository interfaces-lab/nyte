import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { calculateCost, parseStreamingJson } from "@nyte-ai/ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@nyte-ai/ai";

type StreamEvent = SDKPartialAssistantMessage["event"];

type ApiUsage = {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
};

export const CLAUDE_CODE_PROVIDER = "claude-code";

export const MIRROR_TOOL = "claude_code";

export const BACKGROUND_TOOL = "BackgroundTasks";

export const NYTE_SERVER = "nyte";

export const NYTE_TOOL_PREFIX = `mcp__${NYTE_SERVER}__`;

export function emptyMessage(model: Model<Api>): AssistantMessage {
  return {
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
}

export function mirrorCall(id: string, name: string, input: Record<string, unknown>): ToolCall {
  return { type: "toolCall", id, name: MIRROR_TOOL, arguments: { id, name, input } };
}

function stopReason(reason: string): StopReason {
  if (reason === "tool_use") return "toolUse";

  if (reason === "max_tokens" || reason === "model_context_window_exceeded") return "length";

  if (reason === "refusal") return "error";

  return "stop";
}

export class Translator {
  readonly #blocks = new Map<number, { readonly index: number; json: string }>();
  readonly #model: Model<Api>;
  readonly #output: AssistantMessage;
  readonly #stream: AssistantMessageEventStream;
  #spent = 0;
  #current = 0;
  #started = false;

  constructor(model: Model<Api>, output: AssistantMessage, stream: AssistantMessageEventStream) {
    this.#model = model;
    this.#output = output;
    this.#stream = stream;
  }

  /** Applies one stream event. Returns the raw stop reason at a message's end, and `"tool_use"` as soon as a Nyte tool call's input is complete: Claude Code waits for Nyte to run it before it runs the message's later calls. */
  apply(event: StreamEvent): string | undefined {
    switch (event.type) {
      case "message_start":
        this.#started = true;
        this.#blocks.clear();
        this.#output.responseId = event.message.id;

        if (event.message.model !== this.#model.id)
          this.#output.responseModel = event.message.model;
        this.#usage(event.message.usage);

        return undefined;
      case "content_block_start":
        this.#start(event.index, event.content_block);

        return undefined;
      case "content_block_delta":
        this.#delta(event.index, event.delta);

        return undefined;
      case "content_block_stop":
        return this.#stop(event.index);
      case "message_delta":
        if (event.delta.stop_reason !== null) {
          this.#output.rawStopReason = event.delta.stop_reason;
          this.#output.stopReason = stopReason(event.delta.stop_reason);

          if (event.delta.stop_reason === "refusal")
            this.#output.errorMessage = "The model refused to complete the request.";
        }

        this.#usage(event.usage);

        return undefined;
      case "message_stop":
        this.#spent += this.#current;
        this.#current = 0;

        return this.#output.rawStopReason ?? "end_turn";
      default:
        return undefined;
    }
  }

  append(call: ToolCall): void {
    const contentIndex = this.#output.content.push(call) - 1;
    this.#stream.push({ type: "toolcall_start", contentIndex, partial: this.#output });
    this.#stream.push({
      type: "toolcall_end",
      contentIndex,
      toolCall: call,
      partial: this.#output,
    });
  }

  #usage(usage: ApiUsage): void {
    const usageOutput = this.#output.usage;

    if (this.#started) {
      usageOutput.input = usage.input_tokens ?? usageOutput.input;
      usageOutput.cacheRead = usage.cache_read_input_tokens ?? usageOutput.cacheRead;
      usageOutput.cacheWrite = usage.cache_creation_input_tokens ?? usageOutput.cacheWrite;
    }

    this.#current = usage.output_tokens ?? this.#current;
    usageOutput.output = this.#spent + this.#current;
    usageOutput.totalTokens =
      usageOutput.input + usageOutput.output + usageOutput.cacheRead + usageOutput.cacheWrite;
    calculateCost(this.#model, usageOutput);
  }

  #start(
    native: number,
    block: Extract<StreamEvent, { type: "content_block_start" }>["content_block"],
  ) {
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
              ? block.name.startsWith(NYTE_TOOL_PREFIX)
                ? {
                    type: "toolCall",
                    id: block.id,
                    name: block.name.slice(NYTE_TOOL_PREFIX.length),
                    arguments: {},
                  }
                : mirrorCall(block.id, block.name, {})
              : undefined;

    if (content === undefined) return;
    const index = this.#output.content.push(content) - 1;
    this.#blocks.set(native, { index, json: "" });

    this.#stream.push({
      type:
        content.type === "text"
          ? "text_start"
          : content.type === "thinking"
            ? "thinking_start"
            : "toolcall_start",
      contentIndex: index,
      partial: this.#output,
    });
  }

  #delta(native: number, delta: Extract<StreamEvent, { type: "content_block_delta" }>["delta"]) {
    const slot = this.#blocks.get(native);

    if (slot === undefined) return;
    const content = this.#output.content[slot.index];
    const contentIndex = slot.index;

    if (delta.type === "text_delta" && content?.type === "text") {
      content.text += delta.text;
      this.#stream.push({
        type: "text_delta",
        contentIndex,
        delta: delta.text,
        partial: this.#output,
      });
    } else if (delta.type === "thinking_delta" && content?.type === "thinking") {
      content.thinking += delta.thinking;
      this.#stream.push({
        type: "thinking_delta",
        contentIndex,
        delta: delta.thinking,
        partial: this.#output,
      });
    } else if (delta.type === "signature_delta" && content?.type === "thinking") {
      content.thinkingSignature = (content.thinkingSignature ?? "") + delta.signature;
    } else if (delta.type === "input_json_delta" && content?.type === "toolCall") {
      slot.json += delta.partial_json;
      const input = parseStreamingJson(slot.json);
      content.arguments = content.name === MIRROR_TOOL ? { ...content.arguments, input } : input;
      this.#stream.push({
        type: "toolcall_delta",
        contentIndex,
        delta: delta.partial_json,
        partial: this.#output,
      });
    }
  }

  #stop(native: number): string | undefined {
    const slot = this.#blocks.get(native);

    if (slot === undefined) return undefined;
    this.#blocks.delete(native);
    const content = this.#output.content[slot.index];
    const contentIndex = slot.index;

    if (content?.type === "text")
      this.#stream.push({
        type: "text_end",
        contentIndex,
        content: content.text,
        partial: this.#output,
      });
    else if (content?.type === "thinking")
      this.#stream.push({
        type: "thinking_end",
        contentIndex,
        content: content.thinking,
        partial: this.#output,
      });
    else if (content?.type === "toolCall") {
      this.#stream.push({
        type: "toolcall_end",
        contentIndex,
        toolCall: content,
        partial: this.#output,
      });

      if (content.name !== MIRROR_TOOL) {
        this.#output.stopReason = "toolUse";

        return "tool_use";
      }
    }

    return undefined;
  }
}
