import type { Plugin } from "@nyte-ai/plugin/core";
import process from "node:process";
import { acquireSessionResources, anthropicProvider } from "@nyte-ai/ai";
import type { ApiKeyAuth, AuthCheck, AuthContext, Provider, ProviderEnv } from "@nyte-ai/ai";
import { discoverClaudeModels, getClaudeStatus, LOGIN_HINT } from "./process.ts";
import { API_ID, createClaudeModelCatalog, PROVIDER_ID } from "./model-catalog.ts";
import type { DiscoveredClaudeModel } from "./model-catalog.ts";
import { streamClaudeCode } from "./stream.ts";

const ENV_NAMES = [
  "NYTE_CLAUDE_CODE_COMMAND",
  "NYTE_CLAUDE_CODE_CONFIG_DIR",
  "NYTE_CLAUDE_CODE_ALLOW_USAGE_CREDITS",
  "CLAUDE_CONFIG_DIR",
] as const;

async function providerEnvironment(ctx: AuthContext): Promise<ProviderEnv> {
  const env: ProviderEnv = {};

  for (const name of ENV_NAMES) {
    const value = await ctx.env(name);

    if (value !== undefined) env[name] = value;
  }

  return env;
}

/** Returns the Anthropic provider using Claude Code's login and CLI; Nyte owns history, approvals and tool execution. */
export function claudeCodeProvider(): Provider {
  const catalog = anthropicProvider();
  const routes = createClaudeModelCatalog();
  let env: ProviderEnv = {};
  let discovered: DiscoveredClaudeModel[] | undefined;

  const check = async ({
    ctx,
    signal,
  }: Pick<Parameters<NonNullable<ApiKeyAuth["check"]>>[0], "ctx" | "signal">): Promise<
    AuthCheck | undefined
  > => {
    env = await providerEnvironment(ctx);
    const status = await getClaudeStatus({ ...process.env, ...env }, signal);

    if (!status.available || !status.loggedIn) return undefined;

    return {
      type: status.subscription ? "oauth" : "api_key",
      source: status.subscription
        ? `Claude Code ${status.plan ?? "subscription"}`
        : "Claude Code CLI",
    };
  };

  return {
    id: PROVIDER_ID,
    name: "Claude Code",
    baseUrl: "process://claude-code",
    auth: {
      apiKey: {
        name: "Claude Code login",
        check,
        async resolve({ ctx, signal }) {
          signal.throwIfAborted();
          env = await providerEnvironment(ctx);

          return { auth: {}, env, source: "Claude Code CLI" };
        },
      },
      oauth: {
        check,
        name: "Claude Code subscription",
        isSubscription: true,
        async login() {
          throw new Error(
            "Claude Code manages its login. Run `claude auth login` in a terminal; Nyte uses it automatically.",
          );
        },
        async refresh(_credential, signal) {
          const status = await getClaudeStatus({ ...process.env, ...env }, signal);

          if (!status.subscription) throw new Error(LOGIN_HINT);

          return {
            type: "oauth",
            access: "claude-code-external",
            refresh: "claude-code-external",
            expires: Date.now() + 365 * 24 * 60 * 60 * 1_000,
          };
        },
        toAuth: async () => ({}),
      },
    },
    getModels() {
      const builtins = catalog.getModels();
      routes.restoreAnthropicModels(builtins);

      if (discovered) return discovered.map(routes.modelFromDiscovery);

      const models = builtins.map((model) => ({
        ...model,
        api: API_ID,
        compat: undefined,
        baseUrl: "process://claude-code",
      }));

      const ids = new Set(models.map((model) => model.id));

      return [...models, ...routes.fallbackClaudeModels().filter((model) => !ids.has(model.id))];
    },
    async refreshModels(context) {
      if (!context.allowNetwork) {
        await catalog.refreshModels?.(context);

        return;
      }

      const results = await Promise.allSettled([
        catalog.refreshModels?.(context),
        discoverClaudeModels({ ...process.env, ...env }, context.signal).then((next) =>
          context.publish({
            update: () => {
              discovered = next;
            },
          }),
        ),
      ]);

      context.signal.throwIfAborted();
      const discovery = results[1];

      if (discovery?.status === "rejected") throw discovery.reason;
    },
    stream: (model, context, options) =>
      streamClaudeCode(
        model,
        context,
        {
          signal: options?.signal,
          env: options?.env,
          timeoutMs: options?.timeoutMs,
          maxTokens: options?.maxTokens,
          sessionId: options?.sessionId,
          cacheRetention: options?.cacheRetention,
        },
        routes,
      ),
    streamSimple: (model, context, options) => streamClaudeCode(model, context, options, routes),
  };
}

export default {
  id: "claude-code",
  activate({ session, signal }) {
    const release = acquireSessionResources(session.id);
    signal.addEventListener("abort", release, { once: true });

    if (signal.aborted) release();
  },
} satisfies Plugin;
