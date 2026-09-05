/**
 * Context checkpoints and abandoned-branch summaries over kernel commits.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/compaction/compaction.ts
 * and https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts
 * Synced with pi d4edf066f.
 */
import {
  contentText,
  isContextOverflow,
  isRecoverableLength,
  retryAssistantCall,
  uuidv7,
} from "@nyte-ai/ai";
import type { Api, AssistantMessage, Model, RetryPolicy, SimpleStreamOptions } from "@nyte-ai/ai";
import type { Context, Message, ProviderCheckpointMaterial, Usage } from "@nyte-ai/schema";
import { Result, type Result as ResultValue } from "./result.ts";
import type { StreamFn, ThinkingLevel } from "../types.ts";
import { contextMessages, modelContext } from "./context.ts";
import { contextCommits } from "./graph.ts";
import { hashObject } from "./hash.ts";
import { withLeaseRenewal } from "./lease.ts";
import type { Commit, CommitBody, Lease, Oid } from "./model.ts";
import { headRef, runRef } from "./names.ts";
import type { Session } from "./store.ts";
import {
  estimateContextTokens,
  estimateModelContextTokens,
  estimateTokens,
} from "./views/context.ts";
import { addUsage } from "./views/usage.ts";

export {
  calculateContextTokens,
  estimateContextTokens,
  estimateTokens,
  type ContextUsageEstimate,
} from "./views/context.ts";

type CompactionErrorCode = "aborted" | "nothing_to_compact" | "summarization_failed";

export class CompactionError extends Error {
  readonly code: CompactionErrorCode;

  constructor(code: CompactionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CompactionError";
    this.code = code;
  }
}

/** Compaction thresholds and retention settings. */
export interface CompactionSettings {
  /** Enable automatic threshold and overflow checkpoints. */
  readonly enabled: boolean;
  /** Tokens reserved for the summary prompt and output. */
  readonly reserveTokens: number;
  /** Approximate recent-context tokens retained verbatim. */
  readonly keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

export function validateCompactionSettings(settings: CompactionSettings): void {
  if (
    !Number.isSafeInteger(settings.reserveTokens) ||
    settings.reserveTokens < 0 ||
    !Number.isSafeInteger(settings.keepRecentTokens) ||
    settings.keepRecentTokens < 0
  ) {
    throw new RangeError("Compaction token counts must be finite non-negative safe integers");
  }
}

/** Whether the reported context leaves less than the configured reserve. */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important signal, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TOOL_RESULT_MAX_CHARS = 2_000;
const DEFAULT_TTL_MS = 30_000;

export interface FileOperations {
  readonly read: Set<string>;
  readonly written: Set<string>;
  readonly edited: Set<string>;
}

interface FileLists {
  readonly readFiles: string[];
  readonly modifiedFiles: string[];
}

function isStringValue(value: unknown): value is string {
  return typeof value === "string";
}

function createFileOps(): FileOperations {
  return { read: new Set(), written: new Set(), edited: new Set() };
}

function extractFileOpsFromMessage(message: Message, fileOps: FileOperations): void {
  if (message.role !== "assistant") return;
  for (const block of message.content) {
    if (block.type !== "toolCall") continue;
    const path = isStringValue(block.arguments.path) ? block.arguments.path : undefined;
    if (path === undefined || path === "") continue;
    switch (block.name) {
      case "read":
        fileOps.read.add(path);
        break;
      case "write":
        fileOps.written.add(path);
        break;
      case "edit":
        fileOps.edited.add(path);
        break;
    }
  }
}

function readTaggedPaths(
  summary: string,
  tag: "read-files" | "modified-files",
  target: Set<string>,
): void {
  const pattern = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`, "g");
  for (const match of summary.matchAll(pattern)) {
    const paths = match[1];
    if (paths === undefined) continue;
    for (const path of paths.split("\n")) {
      if (path !== "") target.add(path);
    }
  }
}

function extractTaggedFileOps(summary: string, fileOps: FileOperations): void {
  readTaggedPaths(summary, "read-files", fileOps.read);
  readTaggedPaths(summary, "modified-files", fileOps.edited);
}

function computeFileLists(fileOps: FileOperations): FileLists {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  const readFiles = [...fileOps.read].filter((path) => !modified.has(path)).sort();
  return { readFiles, modifiedFiles: [...modified].sort() };
}

function formatFileOperations(
  readFiles: readonly string[],
  modifiedFiles: readonly string[],
): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  return sections.length === 0 ? "" : `\n\n${sections.join("\n\n")}`;
}

function safeJsonStringify<Value>(value: Value): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function summaryStreamOptions(
  maxTokens: number,
  model: Model<Api>,
  thinkingLevel: ThinkingLevel | undefined,
): SimpleStreamOptions {
  const options: SimpleStreamOptions = { maxTokens };
  return model.reasoning && thinkingLevel !== undefined && thinkingLevel !== "off"
    ? { ...options, reasoning: thinkingLevel }
    : options;
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${String(truncatedChars)} more characters truncated]`;
}

/** Serialize provider messages into plain text, limiting large tool results. */
export function serializeConversation(messages: readonly Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "user": {
        const text = contentText(message.content, "");
        if (text !== "") parts.push(`[User]: ${text}`);
        break;
      }
      case "assistant": {
        const thinkingParts: string[] = [];
        const toolCalls: string[] = [];
        for (const block of message.content) {
          switch (block.type) {
            case "thinking":
              thinkingParts.push(block.thinking);
              break;
            case "toolCall": {
              const args = Object.entries(block.arguments)
                .map(([key, value]) => `${key}=${safeJsonStringify(value)}`)
                .join(", ");
              toolCalls.push(`${block.name}(${args})`);
              break;
            }
            case "text":
              break;
            default: {
              const _exhaustive: never = block;
              return _exhaustive;
            }
          }
        }
        if (thinkingParts.length > 0) {
          parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
        }
        if (message.content.some((block) => block.type === "text")) {
          parts.push(`[Assistant]: ${contentText(message.content)}`);
        }
        if (toolCalls.length > 0) {
          parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
        }
        break;
      }
      case "toolResult": {
        const text = contentText(message.content, "");
        if (text !== "") {
          parts.push(`[Tool result]: ${truncateForSummary(text, TOOL_RESULT_MAX_CHARS)}`);
        }
        break;
      }
      default: {
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
  }
  return parts.join("\n\n");
}

async function completeSimpleWithRetries(input: {
  readonly streamFn: StreamFn;
  readonly model: Model<Api>;
  readonly context: { readonly systemPrompt: string; readonly messages: Message[] };
  readonly options: SimpleStreamOptions;
  readonly retry?: RetryPolicy;
  readonly signal?: AbortSignal;
}): Promise<AssistantMessage> {
  const requestOptions: SimpleStreamOptions = {
    ...input.options,
    signal: input.signal,
    cacheRetention: "none",
    sessionId: uuidv7(),
  };
  return retryAssistantCall(
    async () => (await input.streamFn(input.model, input.context, requestOptions)).result(),
    input.retry,
    requestOptions.signal,
  );
}

export interface SummaryGenerationInput {
  readonly currentMessages: readonly Message[];
  readonly streamFn: StreamFn;
  readonly model: Model<Api>;
  readonly reserveTokens: number;
  readonly customInstructions?: string;
  readonly previousSummary?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly retry?: RetryPolicy;
  readonly signal?: AbortSignal;
}

/** Generate or update a checkpoint summary with bounded provider retries. */
export function generateSummaryWithUsage(
  input: SummaryGenerationInput,
): Promise<ResultValue<{ readonly text: string; readonly usage: Usage }, CompactionError>> {
  return generateBoundedSummary(input, "checkpoint");
}

async function generateBoundedSummary(
  input: SummaryGenerationInput,
  kind: "checkpoint" | "turn-prefix" | "branch",
): Promise<ResultValue<{ readonly text: string; readonly usage: Usage }, CompactionError>> {
  const maxTokens = Math.max(
    1,
    Math.min(
      Math.floor((kind === "turn-prefix" ? 0.5 : 0.8) * input.reserveTokens),
      input.model.maxTokens > 0 ? input.model.maxTokens : Number.POSITIVE_INFINITY,
      Math.floor(input.model.contextWindow / 4),
    ),
  );
  // Use the same character heuristic as context estimation, reserving room for
  // output and message framing. Provider usage from native history cannot size
  // this portable prompt: that history may span many compacted windows.
  let promptChars =
    Math.floor((input.model.contextWindow - maxTokens) * 4) -
    SUMMARIZATION_SYSTEM_PROMPT.length -
    64;
  const instructionsFor = (previousSummary: string | undefined): string => {
    let instructions: string;
    switch (kind) {
      case "checkpoint":
        instructions =
          previousSummary === undefined ? SUMMARIZATION_PROMPT : UPDATE_SUMMARIZATION_PROMPT;
        break;
      case "turn-prefix":
        instructions =
          (previousSummary === undefined
            ? ""
            : "Update the previous prefix summary with this next part of the conversation.\n\n") +
          TURN_PREFIX_SUMMARIZATION_PROMPT;
        break;
      case "branch":
        instructions =
          (previousSummary === undefined
            ? ""
            : "Update the previous branch summary with this next part of the conversation.\n\n") +
          BRANCH_SUMMARY_PROMPT;
        break;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
    if (input.customInstructions !== undefined && input.customInstructions !== "") {
      instructions += `\n\nAdditional focus: ${input.customInstructions}`;
    }
    return instructions;
  };
  const promptFor = (conversation: string, previousSummary: string | undefined): string =>
    `<conversation>\n${conversation}\n</conversation>\n\n` +
    (previousSummary === undefined
      ? ""
      : `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`) +
    instructionsFor(previousSummary);

  const label =
    kind === "branch"
      ? "Branch summarization"
      : kind === "turn-prefix"
        ? "Turn prefix summarization"
        : "Summarization";
  let remaining = serializeConversation(input.currentMessages);
  let previousSummary = input.previousSummary;
  // A summary created by a larger model may itself need to be folded in chunks.
  if (previousSummary !== undefined && promptFor("", previousSummary).length >= promptChars) {
    remaining = `[Previous summary]: ${previousSummary}\n\n${remaining}`;
    previousSummary = undefined;
  }
  let usage: Usage | undefined;
  while (true) {
    if (input.signal?.aborted) {
      return Result.err(new CompactionError("aborted", `${label} aborted`));
    }
    const availableChars = promptChars - promptFor("", previousSummary).length;
    if (availableChars <= 0) {
      return Result.err(
        new CompactionError(
          "summarization_failed",
          "The model context window cannot fit the summarization instructions and previous summary",
        ),
      );
    }
    const boundary = Math.max(
      remaining.lastIndexOf("\n", availableChars - 1),
      remaining.lastIndexOf(" ", availableChars - 1),
    );
    const chunkLength =
      remaining.length > availableChars && boundary > availableChars / 2
        ? boundary + 1
        : availableChars;
    const chunk = remaining.slice(0, chunkLength);
    const response = await completeSimpleWithRetries({
      streamFn: input.streamFn,
      model: input.model,
      context: {
        systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: promptFor(chunk, previousSummary), timestamp: Date.now() },
        ],
      },
      options: summaryStreamOptions(maxTokens, input.model, input.thinkingLevel),
      retry: input.retry,
      signal: input.signal,
    });
    if (input.signal?.aborted || response.stopReason === "aborted") {
      return Result.err(
        new CompactionError("aborted", response.errorMessage || `${label} aborted`),
      );
    }
    if (
      response.stopReason === "error" &&
      isContextOverflow(response, input.model.contextWindow) &&
      chunk.length > 1
    ) {
      // Token density varies by language/provider. Retry this same text with a
      // smaller chunk when the provider rejects the character estimate.
      promptChars = promptFor(chunk, previousSummary).length - Math.ceil(chunk.length / 2);
      continue;
    }
    if (response.stopReason === "error") {
      return Result.err(
        new CompactionError(
          "summarization_failed",
          `${label} failed: ${response.errorMessage || "Unknown error"}`,
        ),
      );
    }
    if (kind === "branch" && response.content.some((block) => block.type === "toolCall")) {
      return Result.err(
        new CompactionError(
          "summarization_failed",
          "Branch summarization attempted to call a tool",
        ),
      );
    }
    remaining = remaining.slice(chunk.length);
    previousSummary = contentText(response.content);
    usage = usage === undefined ? response.usage : addUsage(usage, response.usage);
    if (remaining.length === 0) return Result.ok({ text: previousSummary, usage });
  }
}

interface CutPoint {
  readonly firstKeptMessageIndex: number;
  readonly turnStartIndex: number;
  readonly isSplitTurn: boolean;
}

function validCutPoints(messages: readonly Message[]): number[] {
  const cutPoints: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) continue;
    switch (message.role) {
      case "user":
      case "assistant":
        cutPoints.push(index);
        break;
      case "toolResult":
        break;
      default: {
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
  }
  return cutPoints;
}

function turnStartIndex(messages: readonly Message[], entryIndex: number): number {
  for (let index = entryIndex; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function findCutPoint(messages: readonly Message[], keepRecentTokens: number): CutPoint {
  const cutPoints = validCutPoints(messages);
  if (cutPoints.length === 0) {
    return { firstKeptMessageIndex: 0, turnStartIndex: -1, isSplitTurn: false };
  }

  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0] ?? 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    accumulatedTokens += estimateTokens(message);
    if (accumulatedTokens < keepRecentTokens) continue;
    for (const candidate of cutPoints) {
      if (candidate >= index) {
        cutIndex = candidate;
        break;
      }
    }
    break;
  }

  const cutMessage = messages[cutIndex];
  const startsTurn = cutMessage?.role === "user";
  const start = startsTurn ? -1 : turnStartIndex(messages, cutIndex);
  return {
    firstKeptMessageIndex: cutIndex,
    turnStartIndex: start,
    isSplitTurn: !startsTurn && start !== -1,
  };
}

export interface PrepareCheckpointOptions {
  /** Override the prior portable summary when importing an external context cut. */
  readonly previousSummary?: string;
}

export interface CheckpointPreparation {
  readonly messagesToSummarize: readonly Message[];
  readonly turnPrefixMessages: readonly Message[];
  readonly retainedTail: readonly Message[];
  readonly isSplitTurn: boolean;
  readonly tokensBefore: number;
  readonly previousSummary?: string;
  readonly fileOps: FileOperations;
  readonly settings: CompactionSettings;
}

/** Select the checkpoint prefix and a provider-safe retained suffix. */
export function prepareCheckpoint(
  commits: readonly { readonly oid: Oid; readonly commit: Commit }[],
  settings: CompactionSettings,
  options?: PrepareCheckpointOptions,
): ResultValue<CheckpointPreparation | undefined, CompactionError> {
  if (commits.length === 0 || commits.at(-1)?.commit.body.kind === "checkpoint") {
    return Result.ok(undefined);
  }

  let checkpointIndex = -1;
  for (let index = commits.length - 1; index >= 0; index -= 1) {
    if (commits[index]?.commit.body.kind === "checkpoint") {
      checkpointIndex = index;
      break;
    }
  }
  const contextualCommits = checkpointIndex < 0 ? commits : commits.slice(checkpointIndex);
  const projected = contextMessages(contextualCommits.map((entry) => entry.commit));
  const checkpoint = checkpointIndex < 0 ? undefined : commits[checkpointIndex]?.commit.body;
  const checkpointBody = checkpoint?.kind === "checkpoint" ? checkpoint : undefined;
  const previousSummary = options?.previousSummary ?? checkpointBody?.summary;
  const compactableMessages =
    checkpointBody === undefined || checkpointBody.summary === "" ? projected : projected.slice(1);
  const cut = findCutPoint(compactableMessages, settings.keepRecentTokens);
  const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptMessageIndex;
  const messagesToSummarize = compactableMessages.slice(0, historyEnd);
  const turnPrefixMessages = cut.isSplitTurn
    ? compactableMessages.slice(cut.turnStartIndex, cut.firstKeptMessageIndex)
    : [];
  const retainedTail = compactableMessages.slice(cut.firstKeptMessageIndex);
  const fileOps = createFileOps();
  if (previousSummary !== undefined) extractTaggedFileOps(previousSummary, fileOps);
  for (const message of [...messagesToSummarize, ...turnPrefixMessages]) {
    extractFileOpsFromMessage(message, fileOps);
  }

  const preparation: CheckpointPreparation = {
    messagesToSummarize,
    turnPrefixMessages,
    retainedTail,
    isSplitTurn: cut.isSplitTurn,
    tokensBefore: estimateContextTokens(projected).tokens,
    fileOps,
    settings,
  };
  return Result.ok(
    previousSummary === undefined ? preparation : { ...preparation, previousSummary },
  );
}

export interface ProviderCompactionRequest {
  readonly context: Context;
  readonly model: Model<Api>;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly tokensBefore: number;
  readonly customInstructions?: string;
}

export type ProviderCompaction = (
  request: ProviderCompactionRequest,
  signal: AbortSignal | undefined,
) => Promise<{ readonly material: ProviderCheckpointMaterial; readonly usage?: Usage } | undefined>;

export interface SummarizeCheckpointInput {
  readonly commits: readonly { readonly oid: Oid; readonly commit: Commit }[];
  readonly streamFn: StreamFn;
  readonly model: Model<Api>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly settings: CompactionSettings;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly customInstructions?: string;
  readonly material?: ProviderCheckpointMaterial;
  readonly signal?: AbortSignal;
  readonly retry?: RetryPolicy;
  readonly providerCompaction?: ProviderCompaction;
  readonly systemPrompt?: string;
  readonly tools?: Context["tools"];
}

async function summarizePreparedCheckpoint(input: {
  readonly preparation: CheckpointPreparation;
  readonly streamFn: StreamFn;
  readonly model: Model<Api>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly customInstructions?: string;
  readonly material?: ProviderCheckpointMaterial;
  readonly signal?: AbortSignal;
  readonly retry?: RetryPolicy;
}): Promise<ResultValue<Extract<CommitBody, { kind: "checkpoint" }>, CompactionError>> {
  const preparation = input.preparation;
  let summary: string;
  let summaryUsage: Usage;

  if (preparation.isSplitTurn && preparation.turnPrefixMessages.length > 0) {
    let historyText = preparation.previousSummary ?? "No prior history.";
    let historyUsage: Usage | undefined;
    if (preparation.messagesToSummarize.length > 0) {
      const history = await generateSummaryWithUsage({
        currentMessages: preparation.messagesToSummarize,
        streamFn: input.streamFn,
        model: input.model,
        reserveTokens: preparation.settings.reserveTokens,
        customInstructions: input.customInstructions,
        previousSummary: preparation.previousSummary,
        thinkingLevel: input.thinkingLevel,
        retry: input.retry,
        signal: input.signal,
      });
      if (!history.ok) return Result.err(history.error);
      historyText = history.value.text;
      historyUsage = history.value.usage;
    }
    const turnPrefix = await generateBoundedSummary(
      {
        currentMessages: preparation.turnPrefixMessages,
        streamFn: input.streamFn,
        model: input.model,
        reserveTokens: preparation.settings.reserveTokens,
        thinkingLevel: input.thinkingLevel,
        retry: input.retry,
        signal: input.signal,
      },
      "turn-prefix",
    );
    if (!turnPrefix.ok) return Result.err(turnPrefix.error);
    summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefix.value.text}`;
    summaryUsage =
      historyUsage === undefined
        ? turnPrefix.value.usage
        : addUsage(historyUsage, turnPrefix.value.usage);
  } else {
    const generated = await generateSummaryWithUsage({
      currentMessages: preparation.messagesToSummarize,
      streamFn: input.streamFn,
      model: input.model,
      reserveTokens: preparation.settings.reserveTokens,
      customInstructions: input.customInstructions,
      previousSummary: preparation.previousSummary,
      thinkingLevel: input.thinkingLevel,
      retry: input.retry,
      signal: input.signal,
    });
    if (!generated.ok) return Result.err(generated.error);
    summary = generated.value.text;
    summaryUsage = generated.value.usage;
  }

  const files = computeFileLists(preparation.fileOps);
  const body: Extract<CommitBody, { kind: "checkpoint" }> = {
    kind: "checkpoint",
    summary: summary + formatFileOperations(files.readFiles, files.modifiedFiles),
    retainedTail: preparation.retainedTail,
    tokensBefore: preparation.tokensBefore,
    usage: summaryUsage,
  };
  return Result.ok(input.material === undefined ? body : { ...body, material: input.material });
}

/** Generate a checkpoint body without reading or writing a store. */
export async function summarizeCheckpoint(
  input: SummarizeCheckpointInput,
): Promise<ResultValue<Extract<CommitBody, { kind: "checkpoint" }>, CompactionError>> {
  const prepared = prepareCheckpoint(input.commits, {
    ...input.settings,
    keepRecentTokens: Math.min(
      input.settings.keepRecentTokens,
      Math.floor(input.model.contextWindow / 2),
    ),
  });
  if (!prepared.ok) return Result.err(prepared.error);
  if (prepared.value === undefined) {
    return Result.err(new CompactionError("nothing_to_compact", "Nothing to compact"));
  }
  if (input.signal?.aborted) {
    return Result.err(new CompactionError("aborted", "Compaction aborted"));
  }
  const commits = input.commits.map((entry) => entry.commit);
  const tokensBefore = estimateModelContextTokens(commits, {
    provider: input.model.provider,
    api: input.model.api,
    model: input.model.id,
  }).tokens;
  const checkpoint = await input.providerCompaction?.(
    {
      context: {
        ...modelContext(commits, {
          provider: input.model.provider,
          api: input.model.api,
          model: input.model.id,
        }),
        systemPrompt: input.systemPrompt,
        tools: input.tools,
      },
      model: input.model,
      reason: input.reason,
      tokensBefore,
      customInstructions: input.customInstructions,
    },
    input.signal,
  );
  if (input.signal?.aborted) {
    return Result.err(new CompactionError("aborted", "Compaction aborted"));
  }
  if (checkpoint !== undefined) {
    // Native context is opaque. Keep portable history for a later model switch;
    // the matching provider replays only material plus messages after this commit.
    return Result.ok({
      kind: "checkpoint",
      summary: "",
      retainedTail: contextMessages(commits),
      material: checkpoint.material,
      tokensBefore,
      usage: checkpoint.usage,
    });
  }
  return summarizePreparedCheckpoint({
    preparation: { ...prepared.value, tokensBefore },
    streamFn: input.streamFn,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    customInstructions: input.customInstructions,
    material: input.material,
    signal: input.signal,
    retry: input.retry,
  });
}

export type WriteCheckpointInput = Omit<SummarizeCheckpointInput, "commits"> & {
  readonly head: string;
  readonly lease?: Lease;
  readonly ttlMs?: number;
};

export type WriteCheckpointOutcome =
  | { readonly kind: "compacted"; readonly commit: Oid }
  | { readonly kind: "aborted" }
  | { readonly kind: "nothing_to_compact" }
  | { readonly kind: "busy"; readonly holder: Lease }
  | { readonly kind: "failed"; readonly error: string };

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Summarize and publish one checkpoint under the head's lease. */
export async function writeCheckpoint(
  session: Session,
  input: WriteCheckpointInput,
): Promise<WriteCheckpointOutcome> {
  if (input.signal?.aborted) return { kind: "aborted" };
  let lease = input.lease;
  let acquiredHere = false;
  if (lease === undefined) {
    const acquired = await session.leases.acquire(
      headRef(input.head),
      input.ttlMs ?? DEFAULT_TTL_MS,
    );
    if (!acquired.ok) return { kind: "busy", holder: acquired.holder };
    lease = acquired.lease;
    acquiredHere = true;
  }

  try {
    const [tip, runOid] = await Promise.all([
      session.refs.read(headRef(input.head)),
      session.refs.read(runRef(input.head)),
    ]);
    const commits = await contextCommits(session.objects, tip);
    const summarized = await withLeaseRenewal(
      { session, lease, ttlMs: input.ttlMs ?? DEFAULT_TTL_MS, signal: input.signal },
      (signal) => summarizeCheckpoint({ ...input, commits, signal }),
    );
    input.signal?.throwIfAborted();
    if (!summarized.ok) {
      if (summarized.error.code === "aborted") return { kind: "aborted" };
      return summarized.error.code === "nothing_to_compact"
        ? { kind: "nothing_to_compact" }
        : { kind: "failed", error: summarized.error.message };
    }

    const commit: Commit = {
      kind: "commit",
      parent: tip,
      body: summarized.value,
      at: Date.now(),
    };
    const commitOid = hashObject(commit);
    await session.objects.put([commit]);
    input.signal?.throwIfAborted();
    const published = await session.refs.update(
      [
        { name: headRef(input.head), from: tip, to: commitOid },
        { name: runRef(input.head), from: runOid, to: runOid },
      ],
      { lease, reason: input.reason },
    );
    if (published.ok) return { kind: "compacted", commit: commitOid };
    return {
      kind: "failed",
      error:
        published.reason === "fenced"
          ? "Checkpoint publication was fenced"
          : `Checkpoint publication conflicted at ${published.name}`,
    };
  } catch (error) {
    if (input.signal?.aborted) return { kind: "aborted" };
    return { kind: "failed", error: errorText(error) };
  } finally {
    if (acquiredHere) await session.leases.release(lease);
  }
}

function branchMessages(commit: Commit): Message[] {
  const body = commit.body;
  switch (body.kind) {
    case "message":
      return body.message.role === "toolResult" ? [] : [body.message];
    case "checkpoint":
      // Native checkpoints have no portable summary; their retained history is
      // the only readable account of the branch, including its later messages.
      return body.summary === ""
        ? contextMessages([commit])
        : contextMessages([commit]).slice(0, 1);
    case "summary":
      return contextMessages([commit]);
    case "config":
    case "note":
      return [];
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
}

export interface BranchSummaryPreparation {
  readonly messages: readonly Message[];
  readonly fileOps: FileOperations;
  readonly totalTokens: number;
}

/** Keep the newest abandoned messages within the prompt budget. */
export function prepareBranchSummary(
  commits: readonly { readonly oid: Oid; readonly commit: Commit }[],
  tokenBudget: number,
): BranchSummaryPreparation {
  const messages: Message[] = [];
  const fileOps = createFileOps();
  let totalTokens = 0;

  for (const entry of commits) {
    const body = entry.commit.body;
    if (body.kind === "message") extractFileOpsFromMessage(body.message, fileOps);
    if (body.kind === "checkpoint") {
      extractTaggedFileOps(body.summary, fileOps);
      if (body.summary === "") {
        for (const message of body.retainedTail) {
          extractFileOpsFromMessage(message, fileOps);
          if (message.role === "user") extractTaggedFileOps(contentText(message.content), fileOps);
        }
      }
    }
    if (body.kind === "summary") extractTaggedFileOps(body.text, fileOps);
  }

  for (let index = commits.length - 1; index >= 0; index -= 1) {
    const entry = commits[index];
    if (entry === undefined) continue;
    const contributed = branchMessages(entry.commit);
    if (contributed.length === 0) continue;
    const tokens = contributed.reduce((sum, message) => sum + estimateTokens(message), 0);
    if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
      const kind = entry.commit.body.kind;
      const isSummary = kind === "checkpoint" || kind === "summary";
      if (isSummary && totalTokens < tokenBudget * 0.9) {
        messages.unshift(...contributed);
        totalTokens += tokens;
      }
      break;
    }
    messages.unshift(...contributed);
    totalTokens += tokens;
  }
  return { messages, fileOps, totalTokens };
}

export interface GenerateBranchSummaryInput {
  readonly preparation: BranchSummaryPreparation;
  readonly streamFn: StreamFn;
  readonly model: Model<Api>;
  readonly reserveTokens: number;
  readonly thinkingLevel?: ThinkingLevel;
  readonly customInstructions?: string;
  readonly signal?: AbortSignal;
  readonly retry?: RetryPolicy;
}

/** Generate a summary body for prepared abandoned commits. */
export async function generateBranchSummary(
  input: GenerateBranchSummaryInput,
): Promise<ResultValue<Extract<CommitBody, { kind: "summary" }>, CompactionError>> {
  const generated = await generateBoundedSummary(
    {
      currentMessages: input.preparation.messages,
      streamFn: input.streamFn,
      model: input.model,
      reserveTokens: input.reserveTokens,
      thinkingLevel: input.thinkingLevel,
      customInstructions: input.customInstructions,
      signal: input.signal,
      retry: input.retry,
    },
    "branch",
  );
  if (!generated.ok) return Result.err(generated.error);

  const files = computeFileLists(input.preparation.fileOps);
  const text = generated.value.text;
  return Result.ok({
    kind: "summary",
    text:
      BRANCH_SUMMARY_PREAMBLE +
      (text === "" ? "No summary generated" : text) +
      formatFileOperations(files.readFiles, files.modifiedFiles),
    usage: generated.value.usage,
  });
}

export interface SummarizeBranchInput {
  readonly abandoned: readonly { readonly oid: Oid; readonly commit: Commit }[];
  readonly streamFn: StreamFn;
  readonly model: Model<Api>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly customInstructions?: string;
  readonly signal?: AbortSignal;
  readonly retry?: RetryPolicy;
}

/** Summarize abandoned commits without reading or writing a store. */
export async function summarizeBranch(
  input: SummarizeBranchInput,
): Promise<ResultValue<Extract<CommitBody, { kind: "summary" }>, CompactionError>> {
  const preparation = prepareBranchSummary(
    input.abandoned,
    Math.max(0, input.model.contextWindow - DEFAULT_COMPACTION_SETTINGS.reserveTokens),
  );
  if (preparation.messages.length === 0) return Result.ok({ kind: "summary", text: "" });
  return generateBranchSummary({
    preparation,
    streamFn: input.streamFn,
    model: input.model,
    reserveTokens: DEFAULT_COMPACTION_SETTINGS.reserveTokens,
    thinkingLevel: input.thinkingLevel,
    customInstructions: input.customInstructions,
    signal: input.signal,
    retry: input.retry,
  });
}

/** Build the commit that carries an abandoned path onto its new parent. */
export function summaryCommit(input: {
  readonly parent: Oid | null;
  readonly body: Extract<CommitBody, { kind: "summary" }>;
  readonly imports: readonly Oid[];
}): Commit {
  return {
    kind: "commit",
    parent: input.parent,
    body: input.body,
    imports: input.imports,
    at: Date.now(),
  };
}

/** Classify an overflow only when the provider response matches the requested model. */
export function isOverflow(message: AssistantMessage, model: Model<Api>): boolean {
  const sameModel = message.provider === model.provider && message.model === model.id;
  return (
    sameModel &&
    (isContextOverflow(message, model.contextWindow) ||
      isRecoverableLength(message, model.maxTokens))
  );
}
