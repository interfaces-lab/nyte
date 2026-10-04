import {
  anthropicProvider,
  createModels,
  openaiProvider,
  openrouterProvider,
  vercelAiGatewayProvider,
  type Models,
} from "@nyte-ai/ai";
import { createNyte, type Nyte, type NyteOptions } from "@nyte-ai/core";
import { localEnvironmentPlugin, systemPromptPlugin } from "@nyte-ai/core/plugins";
import { openaiAstraContextPlugin } from "@nyte-ai/plugin/openai-astra-context";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { createNyteServer } from "@nyte-ai/server";
import { withDispatch, type WakeTarget } from "@nyte-ai/vercel";
import type { DispatchOutbox } from "@nyte-ai/vercel/outbox";
import { getVercelOidcToken } from "@vercel/functions/oidc";

export type WakeSession = (input: WakeTarget) => Promise<void>;

/** Sessions record this id; changing it makes them unreachable. */
const ENVIRONMENT_ID = "9ec9572b-d5eb-4bb6-83ff-0002da282978";

export function createServerModels(secrets: Readonly<Record<string, string | undefined>>) {
  const models = createModels({
    authContext: {
      env: async (name) => {
        const value =
          name === "VERCEL_OIDC_TOKEN" && secrets.VERCEL === "1"
            ? await requestOidcToken()
            : secrets[name];

        return value === "" ? undefined : value;
      },
      fileExists: async () => false,
    },
  });

  models.setProvider(vercelAiGatewayProvider());
  models.setProvider(openrouterProvider());
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());

  return models;
}

async function requestOidcToken() {
  try {
    return await getVercelOidcToken();
  } catch (error) {
    if (error instanceof Error && error.name === "VercelOidcTokenError") return undefined;
    throw error;
  }
}

export function createChatSdk(options: Pick<NyteOptions, "store" | "model"> & { models: Models }) {
  return createNyte({
    ...options,
    streamFn: (model, context, streamOptions) =>
      options.models.streamSimple(model, context, streamOptions),
    plugins: [
      localEnvironmentPlugin({ id: ENVIRONMENT_ID }),
      systemPromptPlugin(),
      openaiCompactionPlugin({ models: options.models }),
      openaiAstraContextPlugin(),
    ],
    thinkingLevel: "medium",
    defaultWorkspace: { kind: "local", id: ENVIRONMENT_ID, cwd: "/" },
  });
}

export function createChatServer({
  sdk,
  token,
  wake,
  outbox,
}: {
  sdk: Nyte;
  token: string;
  wake: WakeSession;
  outbox: Pick<DispatchOutbox, "record" | "settle">;
}) {
  return createNyteServer({
    sdk: withDispatch({ sdk, wake, outbox }),
    version: "0.0.3-vercel",
    auth: { kind: "token", token },
    describe: () => ({ capabilities: { workspace: false }, persistence: "durable" }),
  });
}
