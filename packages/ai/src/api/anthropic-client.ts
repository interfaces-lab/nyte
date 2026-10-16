/**
 * The Anthropic SDK client for a request: compat defaults, beta headers,
 * authentication (API key, OAuth, Copilot, OIDC federation) and header merging.
 */
import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import {
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_SERVICE_ACCOUNT_ID_ENV,
  ANTHROPIC_WORKSPACE_ID_ENV,
} from "../env-api-keys.ts";
import type {
  AnthropicMessagesCompat,
  Model,
  ProviderEnv,
  ProviderHeaders,
  TranscriptContext,
} from "../types.ts";
import { hasHeader, mergeProviderHeaders } from "../utils/headers.ts";
import { getNyteUserAgent } from "../utils/nyte-user-agent.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { getCurrentTools } from "../utils/transcript.ts";
import { claudeCodeVersion, usesClaudeSubscription } from "./claude-code.ts";

const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

export const FAST_MODE_BETA = "fast-mode-2026-02-01";

const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";

const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const MID_CONVERSATION_TOOL_CHANGES_BETA = "mid-conversation-tool-changes-2026-07-01";

export function shouldUseServerSideFallbackBeta(model: Model<"anthropic-messages">): boolean {
  return (model.compat?.allowedFallbackModels?.length ?? 0) > 0;
}

export function getAnthropicCompat(
  model: Model<"anthropic-messages">,
): Required<Omit<AnthropicMessagesCompat, "forceAdaptiveThinking" | "allowedFallbackModels">> {
  return {
    supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? true,
    supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    sendSessionAffinityHeaders: model.compat?.sendSessionAffinityHeaders ?? false,
    supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? true,
    supportsTemperature: model.compat?.supportsTemperature ?? true,
    allowEmptySignature: model.compat?.allowEmptySignature ?? false,
    supportsStrictTools: model.compat?.supportsStrictTools ?? false,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    supportsMidConvoToolChanges: model.compat?.supportsMidConvoToolChanges ?? false,
    supportsToolReferences:
      model.compat?.supportsToolReferences ?? defaultSupportsToolReferences(model),
  };
}

/**
 * Default for `supportsToolReferences`: first-party Anthropic models except
 * Haiku (rejects client-side tool_reference blocks) and models that predate
 * tool search (Claude 3.x, Opus/Sonnet 4.0, Opus 4.1).
 */
function defaultSupportsToolReferences(model: Model<"anthropic-messages">): boolean {
  if (model.provider !== "anthropic" || model.id.includes("haiku")) return false;
  const version = model.id.match(/^claude-(?:opus|sonnet|fable)-(\d+)(?:-(\d+))?(?:-|$)/);

  if (!version) return false;
  const major = Number(version[1]);
  const minor = version[2] && version[2].length < 8 ? Number(version[2]) : 0;

  return major > 4 || (major === 4 && minor >= 5);
}

// appendAnthropicBeta accumulates flags across differently-cased beta headers, so each spelling keeps its latest value.
export function mergeAnthropicHeaders(
  ...headerSources: (ProviderHeaders | undefined)[]
): ProviderHeaders {
  const merged = mergeProviderHeaders(...headerSources);

  for (const name of Object.keys(merged)) {
    if (name.toLowerCase() === "anthropic-beta") delete merged[name];
  }

  for (const headers of headerSources) {
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (name.toLowerCase() === "anthropic-beta") merged[name] = value;
    }
  }

  return merged;
}

export function appendAnthropicBeta(
  headers: ProviderHeaders,
  beta: string | undefined,
): ProviderHeaders {
  if (!beta) return headers;
  const values: string[] = [];

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "anthropic-beta") continue;
    delete headers[name];

    if (value === null) continue;

    for (const entry of value.split(",")) {
      const normalized = entry.trim();

      if (normalized && !values.includes(normalized)) values.push(normalized);
    }
  }

  if (!values.includes(beta)) values.push(beta);
  headers["anthropic-beta"] = values.join(",");

  return headers;
}

function mergeClientHeaders(...headerSources: (ProviderHeaders | undefined)[]): ProviderHeaders {
  return mergeAnthropicHeaders({ "User-Agent": getNyteUserAgent() }, ...headerSources);
}

function hasRequestAuth(apiKey: string | undefined, headers: ProviderHeaders | undefined): boolean {
  return (
    !!apiKey ||
    hasHeader(headers, "authorization") ||
    hasHeader(headers, "x-api-key") ||
    hasHeader(headers, "cf-aig-authorization")
  );
}

export function assertRequestAuth(
  provider: string,
  apiKey: string | undefined,
  headers: ProviderHeaders | undefined,
): void {
  if (!hasRequestAuth(apiKey, headers)) throw new Error(`No API key for provider: ${provider}`);
}

class PiAnthropic extends Anthropic {
  protected override _shouldResolveDefaultCredentials(): boolean {
    return false;
  }
}

type AnthropicFederationConfig = NonNullable<ClientOptions["config"]>;

export function getAnthropicFederation(
  model: Model<"anthropic-messages">,
  apiKey: string | undefined,
  headers: ProviderHeaders | undefined,
  env: ProviderEnv | undefined,
): AnthropicFederationConfig | undefined {
  if (model.provider !== "anthropic" || hasRequestAuth(apiKey, headers)) return undefined;

  const federationRuleId = getProviderEnvValue(ANTHROPIC_FEDERATION_RULE_ID_ENV, env);
  const organizationId = getProviderEnvValue(ANTHROPIC_ORGANIZATION_ID_ENV, env);
  const identityTokenFile = getProviderEnvValue(ANTHROPIC_IDENTITY_TOKEN_FILE_ENV, env);

  if (!federationRuleId || !organizationId || !identityTokenFile) return undefined;

  return {
    organization_id: organizationId,
    workspace_id: getProviderEnvValue(ANTHROPIC_WORKSPACE_ID_ENV, env),
    authentication: {
      type: "oidc_federation",
      federation_rule_id: federationRuleId,
      service_account_id: getProviderEnvValue(ANTHROPIC_SERVICE_ACCOUNT_ID_ENV, env),
      identity_token: { source: "file", path: identityTokenFile },
    },
  };
}

let federationClient:
  | { key: string; fetch: typeof globalThis.fetch | undefined; client: Anthropic }
  | undefined;

/**
 * The SDK client and whether it signs in as Claude Code. Adaptive thinking models have
 * interleaved thinking built in, so they skip the interleaved-thinking beta header.
 */
export function createClient(
  model: Model<"anthropic-messages">,
  apiKey: string | undefined,
  interleavedThinking: boolean,
  useFineGrainedToolStreamingBeta: boolean,
  useServerSideFallbackBeta: boolean,
  useFastModeBeta: boolean,
  useMidConversationToolChangesBeta: boolean,
  optionsHeaders?: ProviderHeaders,
  fetch?: typeof globalThis.fetch,
  dynamicHeaders?: ProviderHeaders,
  sessionId?: string,
  federation?: AnthropicFederationConfig,
) {
  const needsInterleavedBeta = interleavedThinking && model.compat?.forceAdaptiveThinking !== true;
  const betaFeatures: string[] = [];

  if (useFineGrainedToolStreamingBeta) {
    betaFeatures.push(FINE_GRAINED_TOOL_STREAMING_BETA);
  }

  if (needsInterleavedBeta) {
    betaFeatures.push(INTERLEAVED_THINKING_BETA);
  }

  if (useServerSideFallbackBeta) {
    betaFeatures.push(SERVER_SIDE_FALLBACK_BETA);
  }

  if (useMidConversationToolChangesBeta) {
    betaFeatures.push(MID_CONVERSATION_TOOL_CHANGES_BETA);
  }

  const browserHeaders: ProviderHeaders = {
    accept: "application/json",
    "anthropic-dangerous-direct-browser-access": "true",
  };

  if (betaFeatures.length > 0) browserHeaders["anthropic-beta"] = betaFeatures.join(",");

  if (model.provider === "github-copilot") {
    const client = new PiAnthropic({
      apiKey: null,
      authToken: apiKey ?? null,
      baseURL: model.baseUrl,
      dangerouslyAllowBrowser: true,
      fetch,
      defaultHeaders: appendAnthropicBeta(
        mergeClientHeaders(browserHeaders, model.headers, dynamicHeaders, optionsHeaders),
        useFastModeBeta ? FAST_MODE_BETA : undefined,
      ),
    });

    return { client, isOAuthToken: false };
  }

  if (apiKey && usesClaudeSubscription(apiKey)) {
    const client = new PiAnthropic({
      apiKey: null,
      authToken: apiKey,
      baseURL: model.baseUrl,
      dangerouslyAllowBrowser: true,
      fetch,
      defaultHeaders: appendAnthropicBeta(
        mergeClientHeaders(
          {
            accept: "application/json",
            "anthropic-dangerous-direct-browser-access": "true",
            "anthropic-beta": ["claude-code-20250219", "oauth-2025-04-20", ...betaFeatures].join(
              ",",
            ),
            "user-agent": `claude-cli/${claudeCodeVersion}`,
            "x-app": "cli",
          },
          model.headers,
          optionsHeaders,
        ),
        useFastModeBeta ? FAST_MODE_BETA : undefined,
      ),
    });

    return { client, isOAuthToken: true };
  }

  const sessionAffinityHeaders: ProviderHeaders =
    sessionId && getAnthropicCompat(model).sendSessionAffinityHeaders
      ? { "x-session-affinity": sessionId }
      : {};

  const defaultHeaders = mergeClientHeaders(
    browserHeaders,
    sessionAffinityHeaders,
    model.headers,
    optionsHeaders,
  );

  if (useFastModeBeta) appendAnthropicBeta(defaultHeaders, FAST_MODE_BETA);

  if (federation) {
    const key = JSON.stringify([model.baseUrl, federation]);

    if (federationClient?.key !== key || federationClient.fetch !== fetch) {
      const client = new PiAnthropic({
        apiKey: null,
        authToken: null,
        config: federation,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        fetch,
      });

      federationClient = { key, fetch, client };
    }

    return { client: federationClient.client.withOptions({ defaultHeaders }), isOAuthToken: false };
  }

  const client = new PiAnthropic({
    apiKey: apiKey ?? null,
    authToken: null,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch,
    defaultHeaders,
  });

  return { client, isOAuthToken: false };
}

export function shouldUseFineGrainedToolStreamingBeta(
  model: Model<"anthropic-messages">,
  context: TranscriptContext,
): boolean {
  return (
    getCurrentTools(context.messages).length > 0 &&
    !getAnthropicCompat(model).supportsEagerToolInputStreaming
  );
}
