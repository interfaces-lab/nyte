import { randomUUID } from "node:crypto";
import type { SDKUserMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { ImageContent, Message, TextContent, ToolCall, UserMessage } from "@nyte-ai/ai";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { BACKGROUND_TOOL, CLAUDE_CODE_PROVIDER, MIRROR_TOOL } from "./translate.ts";

type MessageParam = SDKUserMessage["message"];

export type ContentBlock = Exclude<MessageParam["content"], string>[number];

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export const mirrorArguments = Type.Object({
  id: Type.String(),
  name: Type.String(),
  input: Type.Record(Type.String(), Type.Unknown()),
});

function readMirrorCall(call: ToolCall) {
  if (call.name !== MIRROR_TOOL || !Value.Check(mirrorArguments, call.arguments)) return undefined;

  return call.arguments;
}

function mediaBlock(
  content: TextContent | ImageContent,
): Extract<ContentBlock, { readonly type: "text" | "image" }> {
  if (content.type === "text") return { type: "text", text: content.text };
  const mediaType = IMAGE_TYPES.find((type) => type === content.mimeType);

  return mediaType === undefined
    ? { type: "text", text: `(${content.mimeType} image omitted)` }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: content.data } };
}

export function userBlocks(message: UserMessage): ContentBlock[] {
  return typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : message.content.map(mediaBlock);
}

function text(content: string | readonly (TextContent | ImageContent)[]): string {
  return typeof content === "string"
    ? content
    : content.map((block) => (block.type === "text" ? block.text : `[${block.mimeType}]`)).join("");
}

export function messageKey(message: Message): string {
  if (message.role === "user") return `u:${text(message.content)}`;

  if (message.role === "toolResult") return `t:${message.toolCallId}`;

  if (message.role === "system") return "s";

  return `a:${message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : [])).join(",")}`;
}

function toParams(messages: readonly Message[], model: string): MessageParam[] {
  const params: MessageParam[] = [];
  const claude = new Map<string, string>();
  const foreign = new Map<string, string>();
  const skipped = new Set<string>();

  const push = (role: MessageParam["role"], content: readonly ContentBlock[]) => {
    if (content.length === 0) return;
    const last = params.at(-1);

    if (last?.role === role && Array.isArray(last.content)) last.content.push(...content);
    else params.push({ role, content: [...content] });
  };

  const closeCalls = () => {
    push(
      "user",
      [...claude.values()].map((id) => ({
        type: "tool_result",
        tool_use_id: id,
        content: "No result provided",
        is_error: true,
      })),
    );
    claude.clear();
  };

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "toolResult") {
      const id = claude.get(message.toolCallId);
      const name = foreign.get(message.toolCallId);

      if (skipped.has(message.toolCallId)) continue;

      if (id !== undefined) {
        claude.delete(message.toolCallId);
        push("user", [
          {
            type: "tool_result",
            tool_use_id: id,
            content: message.content.map(mediaBlock),
            is_error: message.isError,
          },
        ]);
      } else {
        push("user", [
          { type: "text", text: `[${name ?? message.toolName} result]\n${text(message.content)}` },
        ]);
      }

      continue;
    }

    closeCalls();

    if (message.role === "user") {
      push("user", userBlocks(message));
      continue;
    }

    if (message.stopReason === "error" || message.stopReason === "aborted") continue;
    const signed = message.provider === CLAUDE_CODE_PROVIDER && message.model === model;

    push(
      "assistant",
      message.content.flatMap((block): ContentBlock[] => {
        if (block.type === "text")
          return block.text.trim() === "" ? [] : [{ type: "text", text: block.text }];

        if (block.type === "thinking") {
          if (!signed || block.thinkingSignature === undefined || block.thinkingSignature === "")
            return [];

          return block.redacted === true
            ? [{ type: "redacted_thinking", data: block.thinkingSignature }]
            : [{ type: "thinking", thinking: block.thinking, signature: block.thinkingSignature }];
        }

        const call = readMirrorCall(block);

        if (call?.name === BACKGROUND_TOOL) {
          skipped.add(block.id);

          return [];
        }

        if (call !== undefined) {
          claude.set(block.id, call.id);

          return [{ type: "tool_use", id: call.id, name: call.name, input: call.input }];
        }

        foreign.set(block.id, block.name);

        return [{ type: "text", text: `[${block.name}]\n${JSON.stringify(block.arguments)}` }];
      }),
    );
  }

  closeCalls();

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

export function sessionEntries(
  messages: readonly Message[],
  input: { readonly session: string; readonly model: string; readonly cwd: string },
): SessionStoreEntry[] {
  const timestamp = new Date().toISOString();
  let parentUuid: string | null = null;

  return toParams(messages, input.model).map((param) => {
    const uuid = randomUUID();

    const entry: SessionStoreEntry = {
      type: param.role,
      uuid,
      parentUuid,
      sessionId: input.session,
      timestamp,
      isSidechain: false,
      userType: "external",
      cwd: input.cwd,
      message:
        param.role === "user"
          ? param
          : {
              id: `msg_${uuid.replaceAll("-", "")}`,
              type: "message",
              role: "assistant",
              model: input.model,
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

export function flatPrompt(messages: readonly Message[]): string {
  const turns = messages.filter((message) => message.role !== "system");

  if (turns.length === 1 && turns[0]?.role === "user") return text(turns[0].content);

  return turns
    .map((message) => {
      if (message.role === "assistant")
        return `Assistant:\n${message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")}`;

      if (message.role === "toolResult")
        return `Tool result (${message.toolName}):\n${text(message.content)}`;

      return message.role === "user" ? `User:\n${text(message.content)}` : "";
    })
    .join("\n\n");
}
