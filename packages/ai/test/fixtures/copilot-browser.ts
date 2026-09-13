import { InMemoryCredentialStore } from "@nyte-ai/ai/auth/credential-store";
import type { AuthInteraction } from "@nyte-ai/ai/auth/types";
import { createModels } from "@nyte-ai/ai/models";
import { githubCopilotProvider } from "@nyte-ai/ai/providers/github-copilot";

/** A browser host supplies its own event bridge; no Node globals are present in the test realm. */
declare const postMessage: (value: unknown) => void;

async function login(): Promise<void> {
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials });
  models.setProvider(githubCopilotProvider({ clientId: "browser-host" }));
  const interaction: AuthInteraction = {
    signal: new AbortController().signal,
    prompt: async () => {
      throw new Error("Unexpected input prompt");
    },
    notify: (event) => postMessage(event),
  };
  await models.login("github-copilot", "oauth", interaction);
  const auth = await models.getAuth("github-copilot");
  const available = await models.getAvailable("github-copilot");
  postMessage({
    type: "complete",
    apiKey: auth?.auth.apiKey,
    origin: auth?.auth.baseUrl,
    models: available.map((model) => model.id),
  });
}

void login().catch((error: unknown) => {
  postMessage({ type: "failed", message: error instanceof Error ? error.message : "Login failed" });
});
