/**
 * Context-window status projected from the messages a model would receive.
 *
 * Token estimation based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/compaction/compaction.ts
 * Synced with pi d4edf066f.
 */
import type { JsonValue, Message, ToolResultMessage, Usage, UserMessage } from "@nyte-ai/schema";
import { contextMessages, modelContext } from "../context.ts";
import type { ContextStatus } from "@nyte-ai/protocol";
import type { Commit } from "../model.ts";
import { usageTokens } from "./usage.ts";

export type { ContextStatus } from "@nyte-ai/protocol";

function assistantUsage(message: Message): Usage | undefined {
  switch (message.role) {
    case "assistant":
      return message.stopReason !== "aborted" &&
        message.stopReason !== "error" &&
        usageTokens(message.usage) > 0
        ? message.usage
        : undefined;
    case "user":
    case "toolResult":
      return undefined;
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

function safeJsonStringify(value: JsonValue): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

const ESTIMATED_IMAGE_CHARS = 4800;

function estimateTextAndImageContentChars(
  content: UserMessage["content"] | ToolResultMessage["content"],
): number {
  if (!Array.isArray(content)) return content.length;

  let chars = 0;
  for (const part of content) {
    switch (part.type) {
      case "text":
        chars += part.text.length;
        break;
      case "image":
        chars += ESTIMATED_IMAGE_CHARS;
        break;
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }
  return chars;
}

/** Estimate one message with the compaction code's character heuristic. */
export function estimateTokens(message: Message): number {
  let chars = 0;
  switch (message.role) {
    case "user":
      return Math.ceil(estimateTextAndImageContentChars(message.content) / 4);
    case "assistant":
      for (const part of message.content) {
        switch (part.type) {
          case "text":
            chars += part.text.length;
            break;
          case "thinking":
            chars += part.thinking.length;
            break;
          case "toolCall":
            chars += part.name.length + safeJsonStringify(part.arguments).length;
            break;
          default: {
            const _exhaustive: never = part;
            return _exhaustive;
          }
        }
      }
      return Math.ceil(chars / 4);
    case "toolResult":
      return Math.ceil(estimateTextAndImageContentChars(message.content) / 4);
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

export interface AssistantUsageInfo {
  readonly usage: Usage;
  readonly index: number;
}

export function lastAssistantUsageInfo(
  messages: readonly Message[],
): AssistantUsageInfo | undefined {
  let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
  let latest: AssistantUsageInfo | undefined;
  for (const [index, message] of messages.entries()) {
    const usage = assistantUsage(message);
    // A replacement prefix, such as a compaction summary, invalidates usage
    // reported before that prefix existed.
    if (usage !== undefined && message.timestamp >= latestPrefixTimestamp) {
      latest = { usage, index };
    }
    latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
  }
  return latest;
}

export interface ContextUsageEstimate {
  readonly tokens: number;
  readonly usageTokens: number;
  readonly trailingTokens: number;
  readonly lastUsageIndex: number | null;
}

export function estimateContextTokens(messages: readonly Message[]): ContextUsageEstimate {
  return estimateContextTokensFromUsage(messages, lastAssistantUsageInfo(messages));
}

function estimateContextTokensFromUsage(
  messages: readonly Message[],
  usageInfo: AssistantUsageInfo | undefined,
): ContextUsageEstimate {
  if (usageInfo === undefined) {
    const tokens = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
  }

  const measuredTokens = usageTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let index = usageInfo.index + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message !== undefined) trailingTokens += estimateTokens(message);
  }
  return {
    tokens: measuredTokens + trailingTokens,
    usageTokens: measuredTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/** Estimate the representation selected for this model, excluding portable backup history. */
export function estimateModelContextTokens(
  commits: readonly Commit[],
  target: Parameters<typeof modelContext>[1],
): ContextUsageEstimate {
  const context = modelContext(commits, target);
  return estimateProjectedModelContextTokens(commits, target, context, () =>
    lastAssistantUsageInfo(context.messages),
  );
}

function estimateProjectedModelContextTokens(
  commits: readonly Commit[],
  target: Parameters<typeof modelContext>[1],
  context: ReturnType<typeof modelContext>,
  getUsageInfo: () => AssistantUsageInfo | undefined,
): ContextUsageEstimate {
  const first = commits[0];
  if (first?.body.kind !== "checkpoint" || first.body.material === undefined) {
    return estimateContextTokensFromUsage(context.messages, getUsageInfo());
  }
  // Native context already is the normalized post-checkpoint tail. Portable
  // context includes backup history, whose usage must be checked separately.
  const afterCheckpoint =
    context.checkpoint === undefined ? contextMessages(commits.slice(1)) : context.messages;
  const latest =
    context.checkpoint === undefined ? lastAssistantUsageInfo(afterCheckpoint) : getUsageInfo();
  const assistant = latest === undefined ? undefined : afterCheckpoint[latest.index];
  if (
    assistant?.role === "assistant" &&
    assistant.provider === target.provider &&
    assistant.api === target.api &&
    assistant.model === target.model
  ) {
    return estimateContextTokensFromUsage(
      context.messages,
      context.checkpoint === undefined ? getUsageInfo() : latest,
    );
  }
  const trailingTokens = context.messages.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );
  if (context.checkpoint === undefined) {
    // A different model receives the expanded portable backup; native usage
    // reports inside it describe an entirely different representation.
    return { tokens: trailingTokens, usageTokens: 0, trailingTokens, lastUsageIndex: null };
  }
  // The compact operation's input describes the old window. Its output is the
  // best available baseline until the next assistant reports actual usage.
  // Without usage, opaque JSON can only provide a rough character estimate.
  const usageTokens = first.body.usage?.output ?? 0;
  const opaqueTokens =
    first.body.usage === undefined
      ? Math.ceil(safeJsonStringify(context.checkpoint.data).length / 4)
      : 0;
  return {
    tokens: usageTokens + opaqueTokens + trailingTokens,
    usageTokens,
    trailingTokens: opaqueTokens + trailingTokens,
    lastUsageIndex: null,
  };
}

/** Project context and last-turn usage from one durable branch. */
export function projectContextStatus(
  commits: readonly Commit[],
  contextWindow: number,
  target?: Parameters<typeof modelContext>[1],
): ContextStatus {
  const context =
    target === undefined ? { messages: contextMessages(commits) } : modelContext(commits, target);
  const usageInfo = lastAssistantUsageInfo(context.messages);
  const estimate =
    target === undefined
      ? estimateContextTokensFromUsage(context.messages, usageInfo)
      : estimateProjectedModelContextTokens(commits, target, context, () => usageInfo);
  const lastUsage = usageInfo?.usage;
  const base: ContextStatus = {
    estimatedTokens: estimate.tokens,
    usageTokens: estimate.usageTokens,
    trailingTokens: estimate.trailingTokens,
    contextWindow,
  };
  const withLastUsage: ContextStatus =
    lastUsage === undefined ? base : { ...base, lastTurnTokens: usageTokens(lastUsage) };
  return contextWindow > 0
    ? { ...withLastUsage, percent: Math.round((estimate.tokens / contextWindow) * 100) }
    : withLastUsage;
}
