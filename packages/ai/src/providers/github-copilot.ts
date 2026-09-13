/** GitHub Copilot's generated model definitions, filtered by the signed-in account's model IDs. */
import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import {
  GITHUB_COPILOT_DEFAULT_ORIGIN,
  GITHUB_COPILOT_HEADERS,
} from "../api/github-copilot-headers.ts";
import {
  githubCopilotOAuth,
  isGitHubCopilotCredential,
  type GitHubCopilotOAuthOptions,
} from "../auth/oauth/github-copilot.ts";
import { createProvider } from "../models.ts";
import { GITHUB_COPILOT_MODELS } from "./github-copilot.models.ts";

export function githubCopilotProvider(options: GitHubCopilotOAuthOptions = {}) {
  return createProvider({
    id: "github-copilot",
    name: "GitHub Copilot",
    baseUrl: GITHUB_COPILOT_DEFAULT_ORIGIN,
    headers: GITHUB_COPILOT_HEADERS,
    promptCache: { minimumRetentionMs: { short: 5 * 60_000, long: 5 * 60_000 } },
    auth: {
      apiKey: envApiKeyAuth("GitHub Copilot token", ["COPILOT_GITHUB_TOKEN"]),
      oauth: githubCopilotOAuth(options),
    },
    models: Object.values(GITHUB_COPILOT_MODELS),
    filterModels: (models, credential) => {
      if (credential?.type !== "oauth") return models;
      if (!isGitHubCopilotCredential(credential)) return [];
      const available = new Set(credential.availableModelIds);
      return models.filter((model) => available.has(model.id));
    },
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
      "openai-responses": openAIResponsesApi(),
    },
  });
}
