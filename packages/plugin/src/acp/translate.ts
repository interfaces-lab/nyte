import type { ContentBlock, ToolCallContent, Usage } from "@agentclientprotocol/sdk";
import { calculateCost } from "@nyte-ai/ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  ToolCall,
} from "@nyte-ai/ai";
import type { ToolClass } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const ACP_PROVIDER = "acp";

export const ACP_API = "acp";

export const MIRROR_TOOL = "acp";

/** A mirror call's arguments: the ACP session it ran in, the agent's own call id, title, kind, input and the paths it touches. */
export const mirrorArguments = Type.Object({
  thread: Type.String(),
  id: Type.String(),
  title: Type.String(),
  kind: Type.String(),
  input: Type.Record(Type.String(), Type.Unknown()),
  paths: Type.Array(Type.String()),
});

export type MirrorArguments = Static<typeof mirrorArguments>;

const command = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Array(Type.String(), { minItems: 1 }),
]);

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

/** The class Nyte shows and gates an agent's tool call by, from the ACP kind, its paths and its input. */
export function mirrorClass(args: MirrorArguments): ToolClass {
  const path = args.paths[0];
  const shell = args.input.command;

  switch (args.kind) {
    case "read":
      return path === undefined ? { kind: "custom", label: args.title } : { kind: "read", path };
    case "edit":
    case "delete":
    case "move":
      return path === undefined ? { kind: "custom", label: args.title } : { kind: "edit", path };
    case "execute":
      return {
        kind: "shell",
        command: Value.Check(command, shell)
          ? Array.isArray(shell)
            ? shell.join(" ")
            : shell
          : args.title,
      };
    default:
      return { kind: "custom", label: args.title };
  }
}

function blockText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "resource_link":
      return block.uri;
    case "resource":
      return "text" in block.resource ? block.resource.text : block.resource.uri;
    default:
      return `[${block.type}]`;
  }
}

/** What a finished agent tool call reports, as the text its mirror call returns. */
export function toolText(content: readonly ToolCallContent[], rawOutput: unknown): string {
  const lines = content.map((item) => {
    switch (item.type) {
      case "content":
        return blockText(item.content);
      case "diff":
        return item.oldText === null || item.oldText === undefined
          ? `Wrote ${item.path}`
          : `Edited ${item.path}`;
      default:
        return `Terminal ${item.terminalId}`;
    }
  });

  if (lines.length > 0) return lines.join("\n");

  if (rawOutput === undefined || rawOutput === null) return "";

  return (Value.Check(Type.String(), rawOutput) ? rawOutput : JSON.stringify(rawOutput)).slice(
    0,
    8_000,
  );
}

/** Builds one assistant message from an agent's streamed text, thoughts and tool calls. */
export class Translator {
  readonly #model: Model<Api>;
  readonly #output: AssistantMessage;
  readonly #stream: AssistantMessageEventStream;
  #open: { readonly kind: "text" | "thinking"; readonly index: number } | undefined;

  constructor(model: Model<Api>, output: AssistantMessage, stream: AssistantMessageEventStream) {
    this.#model = model;
    this.#output = output;
    this.#stream = stream;
  }

  text(delta: string): void {
    const index = this.#start("text");
    const block = this.#output.content[index];

    if (block?.type !== "text") return;
    block.text += delta;
    this.#stream.push({ type: "text_delta", contentIndex: index, delta, partial: this.#output });
  }

  thinking(delta: string): void {
    const index = this.#start("thinking");
    const block = this.#output.content[index];

    if (block?.type !== "thinking") return;
    block.thinking += delta;
    this.#stream.push({
      type: "thinking_delta",
      contentIndex: index,
      delta,
      partial: this.#output,
    });
  }

  call(call: ToolCall): void {
    this.end();
    const contentIndex = this.#output.content.push(call) - 1;
    this.#stream.push({ type: "toolcall_start", contentIndex, partial: this.#output });
    this.#stream.push({
      type: "toolcall_end",
      contentIndex,
      toolCall: call,
      partial: this.#output,
    });
  }

  usage(usage: Usage): void {
    const target = this.#output.usage;
    target.input = usage.inputTokens;
    target.output = usage.outputTokens;
    target.cacheRead = usage.cachedReadTokens ?? 0;
    target.cacheWrite = usage.cachedWriteTokens ?? 0;
    target.totalTokens = usage.totalTokens;
    calculateCost(this.#model, target);
  }

  end(): void {
    const open = this.#open;
    this.#open = undefined;

    if (open === undefined) return;
    const block = this.#output.content[open.index];

    if (block?.type === "text")
      this.#stream.push({
        type: "text_end",
        contentIndex: open.index,
        content: block.text,
        partial: this.#output,
      });
    else if (block?.type === "thinking")
      this.#stream.push({
        type: "thinking_end",
        contentIndex: open.index,
        content: block.thinking,
        partial: this.#output,
      });
  }

  #start(kind: "text" | "thinking"): number {
    if (this.#open?.kind === kind) return this.#open.index;
    this.end();

    const index =
      this.#output.content.push(
        kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" },
      ) - 1;

    this.#open = { kind, index };
    this.#stream.push({
      type: kind === "text" ? "text_start" : "thinking_start",
      contentIndex: index,
      partial: this.#output,
    });

    return index;
  }
}
