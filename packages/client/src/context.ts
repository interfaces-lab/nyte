/**
 * Projects kernel commits into model context. A checkpoint replaces earlier
 * commits with its portable summary and retained tail, or with matching native
 * provider material.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/session/context.ts
 * Synced with pi d4edf066f.
 */
import type {
  Api,
  Message,
  ProviderCheckpointMaterial,
  ProviderId,
  UserMessage,
} from "@nyte-ai/schema";
import type { BranchConfig, Commit, JobInfo, ModelRef } from "@nyte-ai/protocol";

export interface ModelContext {
  readonly messages: Message[];
  readonly checkpoint?: ProviderCheckpointMaterial;
}

export const COMPACTION_SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const COMPACTION_SUMMARY_SUFFIX = "\n</summary>";

function createCompactionSummaryMessage(summary: string, timestamp: number): UserMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX,
      },
    ],
    timestamp,
  };
}

const BRANCH_SUMMARY_PREFIX =
  "The following is a summary of a branch that this conversation came back from:\n\n<summary>\n";
const BRANCH_SUMMARY_SUFFIX = "\n</summary>";

/** A branch summary joins context as one user message; nothing before it is dropped. */
function createBranchSummaryMessage(summary: string, timestamp: number): UserMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: BRANCH_SUMMARY_PREFIX + summary + BRANCH_SUMMARY_SUFFIX,
      },
    ],
    timestamp,
  };
}

/** Provider failures stay visible in history but must not poison later requests. */
function isContextMessage(message: Message): boolean {
  return (
    message.role !== "assistant" ||
    (message.stopReason !== "error" &&
      message.stopReason !== "aborted" &&
      message.stopReason !== "deferred")
  );
}

/**
 * Providers reject a tool result without its call in the adjacent assistant
 * message, and a call with no result. Real branches hold both cases, so this
 * drops orphaned results and settles unanswered calls as interrupted.
 */
function enforceToolPairs(messages: readonly Message[]): Message[] {
  const output: Message[] = [];
  let open = new Map<string, { name: string; timestamp: number }>();
  const settleOpen = (): void => {
    for (const [toolCallId, call] of open) {
      output.push({
        role: "toolResult",
        toolCallId,
        toolName: call.name,
        content: [
          {
            type: "text",
            text: `Error: tool call "${call.name}" was interrupted before completing and was not replayed.`,
          },
        ],
        details: {},
        isError: true,
        timestamp: call.timestamp,
      });
    }
    open = new Map();
  };

  for (const message of messages) {
    if (message.role === "toolResult") {
      if (!open.delete(message.toolCallId)) continue;
      output.push(message);
      continue;
    }
    settleOpen();
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "toolCall") {
          open.set(part.id, { name: part.name, timestamp: message.timestamp });
        }
      }
    }
    output.push(message);
  }
  settleOpen();
  return output;
}

/** The message a finished background job lands as. The model reads it as a new user turn. */
export function completionText(job: JobInfo): string {
  const subject =
    job.kind === "subagent" ? `subagent ${job.title} (${job.id})` : `command ${job.id}`;
  const outcome =
    job.state === "completed"
      ? job.kind === "subagent"
        ? "finished. Its report:"
        : `exited: \`${job.title}\`. Its output:`
      : job.state === "failed"
        ? "failed:"
        : `was ${job.state}.`;
  const output = job.output === "" ? "(no output)" : job.output;
  return `Background ${subject} ${outcome}\n\n${output}`;
}

/** Convert oldest-first commits into provider-safe model messages. */
export function contextMessages(commits: readonly Commit[]): Message[] {
  const messages: Message[] = [];
  for (const commit of commits) {
    const body = commit.body;
    switch (body.kind) {
      case "message":
        if (isContextMessage(body.message)) messages.push(body.message);
        break;
      case "completion":
        messages.push({
          role: "user",
          timestamp: commit.at,
          content: completionText(body.job),
        });
        break;
      case "checkpoint":
        if (body.summary !== "")
          messages.push(createCompactionSummaryMessage(body.summary, commit.at));
        messages.push(...body.retainedTail.filter(isContextMessage));
        break;
      case "summary":
        if (body.text !== "") messages.push(createBranchSummaryMessage(body.text, commit.at));
        break;
      case "config":
        break;
      default: {
        const _exhaustive: never = body;
        return _exhaustive;
      }
    }
  }
  return enforceToolPairs(messages);
}

/** Use native checkpoint data only for the exact target that produced it. */
export function modelContext(
  commits: readonly Commit[],
  target: { readonly provider: ProviderId; readonly api: Api; readonly model: string },
): ModelContext {
  const first = commits[0];
  if (
    first?.body.kind === "checkpoint" &&
    first.body.material?.provider === target.provider &&
    first.body.material.api === target.api &&
    first.body.material.model === target.model
  ) {
    return {
      checkpoint: first.body.material,
      messages: contextMessages(commits.slice(1)),
    };
  }
  return { messages: contextMessages(commits) };
}

/**
 * Fold the run inputs declared across the whole branch. Each defined field in
 * a later config commit replaces the earlier value, including across checkpoints.
 */
export function branchConfig(commits: readonly Pick<Commit, "body">[]): BranchConfig {
  let model: ModelRef | undefined;
  let thinkingLevel: string | undefined;
  let agent: string | undefined;

  for (const commit of commits) {
    const body = commit.body;
    switch (body.kind) {
      case "config":
        if (body.model !== undefined) model = body.model;
        if (body.thinkingLevel !== undefined) thinkingLevel = body.thinkingLevel;
        if (body.agent !== undefined) agent = body.agent;
        break;
      case "message":
        if (body.agent !== undefined) agent = body.agent;
        break;
      case "completion":
      case "checkpoint":
      case "summary":
        break;
      default: {
        const _exhaustive: never = body;
        return _exhaustive;
      }
    }
  }

  let config: BranchConfig = {};
  if (model !== undefined) config = { ...config, model };
  if (thinkingLevel !== undefined) config = { ...config, thinkingLevel };
  if (agent !== undefined) config = { ...config, agent };
  return config;
}
