/**
 * A chat-only Nyte host served over the wire. Sessions have a system prompt
 * and the providers' context policies, no workspace and no tools: nothing
 * that needs a filesystem. Provider keys are read from the deployment's
 * secrets; nothing is ever written back.
 */
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  anthropicProvider,
  createModels,
  openaiProvider,
  type AuthContext,
} from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import { inlinePlugin, systemPromptPlugin } from "@nyte-ai/core/plugins";
import type { Store } from "@nyte-ai/core/store";
import { openaiAstraContextPlugin } from "@nyte-ai/plugin/openai-astra-context";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { createNyteServer, type NyteServer } from "@nyte-ai/server";

export interface ChatHostOptions {
  readonly store: Store;
  /** `NYTE_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ... as the platform exposes them. */
  readonly secrets: Readonly<Record<string, unknown>>;
  /** `provider/id`, the model a session uses until it declares one. */
  readonly model: string;
  readonly version: string;
}

function secretsAuthContext(secrets: ChatHostOptions["secrets"]): AuthContext {
  return {
    env: async (name) => {
      const value = secrets[name];
      return typeof value === "string" && value.length > 0 ? value : undefined;
    },
    fileExists: async () => false,
  };
}

/** Composes the SDK, attaches its runner, and answers with the wire handler over it. */
export async function createChatHost(options: ChatHostOptions): Promise<NyteServer> {
  const token = options.secrets.NYTE_TOKEN;
  if (typeof token !== "string") throw new Error("NYTE_TOKEN secret is required");
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    authContext: secretsAuthContext(options.secrets),
  });
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  const slash = options.model.indexOf("/");
  const model =
    slash === -1
      ? undefined
      : models.getModel(options.model.slice(0, slash), options.model.slice(slash + 1));
  if (model === undefined) throw new Error(`NYTE_MODEL must be "provider/id": ${options.model}`);
  const sdk = await createNyte({
    store: options.store,
    streamFn: (target, context, streamOptions) =>
      models.streamSimple(target, context, streamOptions),
    models,
    model,
    plugins: [
      inlinePlugin(systemPromptPlugin()),
      inlinePlugin(openaiCompactionPlugin({ models })),
      inlinePlugin(openaiAstraContextPlugin()),
    ],
    env: { cwd: "/" },
  });
  sdk.attach();
  return createNyteServer({ sdk, version: options.version, auth: { kind: "token", token } });
}
