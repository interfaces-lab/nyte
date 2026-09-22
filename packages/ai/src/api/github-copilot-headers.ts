/** Copilot wire identity from Pi 71dca871; interaction metadata follows OpenCode v2 9dd7149e. */
import type { Message, ProviderHeaders } from "../types.ts";

export const GITHUB_COPILOT_API_VERSION = "2026-06-01";

export const GITHUB_COPILOT_DEFAULT_ORIGIN = "https://api.individual.githubcopilot.com";

export const GITHUB_COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const;

export function buildCopilotDynamicHeaders(input: {
  messages: readonly Message[];
  sessionId?: string;
}): ProviderHeaders {
  const last = input.messages.at(-1);

  const headers: ProviderHeaders = {
    "X-GitHub-Api-Version": GITHUB_COPILOT_API_VERSION,
    "X-Initiator": last && last.role !== "user" ? "agent" : "user",
    "Openai-Intent": "conversation-edits",
    // The stream contract does not distinguish subagent, title, or compaction requests.
    "X-Interaction-Type": "conversation-agent",
  };

  if (input.sessionId) headers["X-Interaction-Id"] = input.sessionId;

  if (
    input.messages.some(
      (message) =>
        (message.role === "user" || message.role === "toolResult") &&
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image"),
    )
  )
    headers["Copilot-Vision-Request"] = "true";

  return headers;
}
