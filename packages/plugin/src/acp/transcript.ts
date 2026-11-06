import type { ContentBlock } from "@agentclientprotocol/sdk/unstable";
import type { ImageContent, Message, TextContent, UserMessage } from "@nyte-ai/ai";
import { excerptText } from "@nyte-ai/core";
import { MIRROR_TOOL } from "./translate.ts";

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

export function userBlocks(message: UserMessage, images: boolean): ContentBlock[] {
  if (typeof message.content === "string") return [{ type: "text", text: message.content }];

  return message.content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text }
      : images
        ? { type: "image", data: block.data, mimeType: block.mimeType }
        : { type: "text", text: `(${block.mimeType} image omitted)` },
  );
}

export function transcriptText(messages: readonly Message[]): string {
  return messages
    .flatMap((message) => {
      if (message.role === "user") return [`User:\n${text(message.content)}`];

      if (message.role === "toolResult")
        return [`Tool result (${message.toolName}):\n${excerptText(text(message.content))}`];

      if (message.role !== "assistant" || message.stopReason === "error") return [];

      const said = message.content.flatMap((block) => {
        if (block.type === "text") return [block.text];

        if (block.type !== "toolCall") return [];
        const title = block.name === MIRROR_TOOL ? block.arguments.title : undefined;

        return [`[${typeof title === "string" ? title : block.name}]`];
      });

      return said.length === 0 ? [] : [`Assistant:\n${said.join("\n")}`];
    })
    .join("\n\n");
}
