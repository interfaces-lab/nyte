import type { AssistantMessage, UserMessage } from "@nyte-ai/schema";
import type { Commit, CommitBody } from "../model.ts";

export interface SessionDirectoryEntry {
  readonly id: string;
  readonly name?: string;
  readonly preview?: string;
  readonly lastActivity: number;
  readonly heads: string[];
}

function userText(content: UserMessage["content"]): string {
  if (!Array.isArray(content)) return content;
  return content
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "image":
          return "";
        default: {
          const _exhaustive: never = part;
          return _exhaustive;
        }
      }
    })
    .join("");
}

function assistantText(content: AssistantMessage["content"]): string {
  return content
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "thinking":
        case "toolCall":
          return "";
        default: {
          const _exhaustive: never = part;
          return _exhaustive;
        }
      }
    })
    .join("");
}

function messagePreview(body: CommitBody): string | undefined {
  switch (body.kind) {
    case "message": {
      let text: string;
      switch (body.message.role) {
        case "user":
          text = userText(body.message.content);
          break;
        case "assistant":
          text = assistantText(body.message.content);
          break;
        case "toolResult":
          return undefined;
        default: {
          const _exhaustive: never = body.message;
          return _exhaustive;
        }
      }
      const preview = text.trim();
      return preview === "" ? undefined : preview;
    }
    case "checkpoint":
    case "summary":
    case "config":
    case "note":
      return undefined;
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
}

/** Build the row shared by session pickers. Heads keep the order the caller gave them. */
export function sessionDirectoryEntry(input: {
  readonly id: string;
  readonly createdAt: number;
  readonly name?: string;
  readonly heads: readonly string[];
  readonly commits: readonly Commit[];
}): SessionDirectoryEntry {
  let preview: { readonly at: number; readonly value: string } | undefined;
  let lastActivity = input.createdAt;

  for (const commit of input.commits) {
    lastActivity = Math.max(lastActivity, commit.at);
    const value = messagePreview(commit.body);
    if (value !== undefined && (preview === undefined || commit.at > preview.at)) {
      preview = { at: commit.at, value };
    }
  }

  const base: SessionDirectoryEntry = {
    id: input.id,
    lastActivity,
    heads: [...new Set(input.heads)],
  };
  const named: SessionDirectoryEntry =
    input.name === undefined ? base : { ...base, name: input.name };
  return preview === undefined ? named : { ...named, preview: preview.value };
}
