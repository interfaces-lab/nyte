import { randomUUID } from "node:crypto";
import type { SDKUserMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { ImageContent, Message, TextContent, UserMessage } from "@nyte-ai/ai";
import { CLAUDE_CODE_PROVIDER, NYTE_TOOL_PREFIX } from "./translate.ts";

type MessageParam = Exclude<SDKUserMessage["message"], { role: "system" }>;

export type ContentBlock = Exclude<MessageParam["content"], string>[number];

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/** Anthropic takes tool use ids of letters, digits, `_` and `-`, and other providers' ids can hold more. */
function toolUseId(id: string): string {
  return id.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
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
  const open = new Set<string>();

  const push = (role: MessageParam["role"], content: readonly ContentBlock[]) => {
    if (content.length === 0) return;
    const last = params.at(-1);

    if (last?.role === role && Array.isArray(last.content)) last.content.push(...content);
    else params.push({ role, content: [...content] });
  };

  const closeCalls = () => {
    push(
      "user",
      [...open].map((id) => ({
        type: "tool_result",
        tool_use_id: toolUseId(id),
        content: "No result provided",
        is_error: true,
      })),
    );
    open.clear();
  };

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "toolResult") {
      push(
        "user",
        open.delete(message.toolCallId)
          ? [
              {
                type: "tool_result",
                tool_use_id: toolUseId(message.toolCallId),
                content: message.content.map(mediaBlock),
                is_error: message.isError,
              },
            ]
          : [{ type: "text", text: `[${message.toolName} result]\n${text(message.content)}` }],
      );

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

        open.add(block.id);

        return [
          {
            type: "tool_use",
            id: toolUseId(block.id),
            name: `${NYTE_TOOL_PREFIX}${block.name}`,
            input: block.arguments,
          },
        ];
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
