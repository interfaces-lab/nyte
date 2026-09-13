import {
  anthropicProvider,
  createModels,
  openaiCodexProvider,
  openaiProvider,
  type Models,
} from "@nyte-ai/ai";
import { createNyte, type Nyte, type NyteOptions } from "@nyte-ai/core";
import { inlinePlugin, systemPromptPlugin } from "@nyte-ai/core/plugins";
import { openaiAstraContextPlugin } from "@nyte-ai/plugin/openai-astra-context";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { createNyteServer } from "@nyte-ai/server";

export type WakeSession = (
  input: Pick<Parameters<Nyte["advance"]>[0], "sessionId" | "head">,
) => Promise<void>;

export function createServerModels(secrets: Readonly<Record<string, unknown>>) {
  const models = createModels({
    authContext: {
      env: async (name) => {
        const value = secrets[name];
        return typeof value === "string" && value.length > 0 ? value : undefined;
      },
      fileExists: async () => false,
    },
  });
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  models.setProvider({
    ...openaiCodexProvider(),
    // Only access tokens leave the local sign-in; the deployed host cannot refresh them.
    auth: {
      apiKey: {
        name: "Codex OAuth access token",
        resolve: async ({ ctx }) => {
          const access = await ctx.env("OPENAI_CODEX_ACCESS_TOKEN");
          return access
            ? { auth: { apiKey: access }, source: "Codex OAuth access token" }
            : undefined;
        },
      },
    },
  });
  return models;
}

export function createChatSdk(options: Pick<NyteOptions, "store" | "model"> & { models: Models }) {
  return createNyte({
    ...options,
    streamFn: (model, context, streamOptions) =>
      options.models.streamSimple(model, context, streamOptions),
    plugins: [
      inlinePlugin(systemPromptPlugin()),
      inlinePlugin(openaiCompactionPlugin({ models: options.models })),
      inlinePlugin(openaiAstraContextPlugin()),
    ],
    env: { cwd: "/" },
  });
}

/** Admission remains core-owned; this host dispatches every accepted wake to Workflow. */
export function createChatServer({
  sdk,
  token,
  wake,
}: {
  sdk: Nyte;
  token: string;
  wake: WakeSession;
}) {
  return createNyteServer({
    sdk: {
      ...sdk,
      sessions: {
        ...sdk.sessions,
        async configure(input) {
          const outcome = await sdk.sessions.configure(input);
          if (outcome.kind === "queued")
            await wake({ sessionId: input.sessionId, head: input.head });
          return outcome;
        },
      },
      messages: {
        ...sdk.messages,
        async send(input) {
          const receipt = await sdk.messages.send(input);
          // Lost dispatch responses can be retried with the same admission key.
          await wake({ sessionId: input.sessionId, head: input.head });
          return receipt;
        },
        async redeliver(input) {
          const outcome = await sdk.messages.redeliver(input);
          if (outcome.kind !== "not_found")
            await wake({ sessionId: input.sessionId, head: input.head });
          return outcome;
        },
      },
      runs: {
        ...sdk.runs,
        async reply(input) {
          const outcome = await sdk.runs.reply(input);
          if (outcome.kind !== "not_found")
            await wake({ sessionId: input.sessionId, head: input.head });
          return outcome;
        },
        async abort(input) {
          const outcome = await sdk.runs.abort(input);
          if (outcome.kind === "requested")
            await wake({ sessionId: input.sessionId, head: input.head });
          return outcome;
        },
      },
    },
    version: "0.0.3-vercel",
    auth: { kind: "token", token },
    describe: () => ({ capabilities: { workspace: false }, persistence: "durable" }),
  });
}
