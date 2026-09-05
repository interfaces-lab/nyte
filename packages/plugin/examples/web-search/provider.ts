/**
 * What a web search provider is and how a provider plugin joins the tool.
 *
 * opencode v2 keeps a `WebSearch` service in core that provider plugins add
 * themselves to. Nyte has no such registry, so the providers ride the tool:
 * the `web-search` plugin contributes `websearch` with an empty provider
 * list, and each provider plugin, activated after it, `update`s the tool to
 * append itself and the routing setting to offer itself. Registries replay in
 * plugin order and `tools` rebuilds before `settings`, so the tool the model
 * sees and the menu the user sees agree.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/websearch.ts
 * and https://github.com/anomalyco/opencode/blob/v2/packages/schema/src/websearch.ts
 */
import { definePlugin } from "@nyte-ai/plugin";
import type { AgentTool, Plugin, SettingChoice } from "@nyte-ai/plugin";

export const WEB_SEARCH_TOOL_NAME = "websearch";
export const WEB_SEARCH_SETTING_ID = "websearch-provider";
/** The routing choice that hides the tool, opencode's `false` selection. */
export const WEB_SEARCH_OFF = "off";
/** opencode sends `App.useragent`; the routes only need to know who is calling. */
export const USER_AGENT = "nyte/web-search";

/** One hit, in opencode's result vocabulary. */
export interface WebSearchResult {
  readonly url: string;
  readonly title?: string;
  readonly content?: string;
  readonly time: { readonly published?: number };
}

/** A hit from its parts. Absent fields stay absent rather than becoming `undefined` keys. */
export function webSearchResult(
  url: string,
  fields: {
    readonly title?: string | null;
    readonly content?: string | null;
    readonly published?: string | null;
  },
): WebSearchResult {
  let result: WebSearchResult = { url, time: {} };
  if (fields.title !== undefined && fields.title !== null && fields.title !== "") {
    result = { ...result, title: fields.title };
  }
  if (fields.content !== undefined && fields.content !== null && fields.content !== "") {
    result = { ...result, content: fields.content };
  }
  if (fields.published !== undefined && fields.published !== null && fields.published !== "") {
    const published = Date.parse(fields.published);
    if (Number.isFinite(published)) result = { ...result, time: { published } };
  }
  return result;
}

export interface WebSearchProviderInput {
  readonly query: string;
  /** A stored or environment key; `undefined` takes the provider's keyless route. */
  readonly key: string | undefined;
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal | undefined;
}

export interface WebSearchProvider {
  readonly id: string;
  readonly name: string;
  /** opencode's `env` integration method: the variable read when the host stores no key. */
  readonly keyEnvironment: string;
  execute(input: WebSearchProviderInput): Promise<readonly WebSearchResult[]>;
}

/** A provider request that failed, with the HTTP status when the route answered at all. */
export class WebSearchRequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options: { readonly status?: number; readonly cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "WebSearchRequestError";
    this.status = options.status;
  }
}

/** The `websearch` tool as the model sees it, carrying the providers that joined it. */
export interface WebSearchProviderCarrier {
  readonly providers: readonly WebSearchProvider[];
}

function isWebSearchProvider(value: unknown): value is WebSearchProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "keyEnvironment" in value &&
    typeof value.keyEnvironment === "string" &&
    "execute" in value &&
    typeof value.execute === "function"
  );
}

export function isWebSearchProviderCarrier(
  tool: AgentTool,
): tool is AgentTool & WebSearchProviderCarrier {
  if (!("providers" in tool) || !Array.isArray(tool.providers)) return false;
  return tool.providers.every(isWebSearchProvider);
}

/** The providers on the materialized `websearch` tool; none when the tool is hidden or absent. */
export function webSearchProviders(tools: readonly AgentTool[]): readonly WebSearchProvider[] {
  const tool = tools.find((candidate) => candidate.name === WEB_SEARCH_TOOL_NAME);
  return tool !== undefined && isWebSearchProviderCarrier(tool) ? tool.providers : [];
}

function withProvider(tool: AgentTool, provider: WebSearchProvider): AgentTool {
  const current = isWebSearchProviderCarrier(tool) ? tool.providers : [];
  const joined: AgentTool & WebSearchProviderCarrier = {
    ...tool,
    providers: [...current.filter((entry) => entry.id !== provider.id), provider],
  };
  return joined;
}

/** Insert a provider's choice ahead of `off`, which stays last however many providers join. */
export function withWebSearchChoice(
  choices: readonly [SettingChoice, ...SettingChoice[]],
  choice: SettingChoice,
): [SettingChoice, ...SettingChoice[]] {
  const [first, ...rest] = choices;
  const middle = rest.filter((entry) => entry.id !== choice.id && entry.id !== WEB_SEARCH_OFF);
  const off = rest.filter((entry) => entry.id === WEB_SEARCH_OFF);
  return [first, ...middle, choice, ...off];
}

/**
 * A provider as its own plugin, the way opencode ships `opencode.websearch.exa`.
 * It joins the tool and nothing else: the routing setting stays owned by the
 * `web-search` plugin, because a setting's storage key is resolved under its
 * owner's prefix and a provider writing to it would move that key.
 *
 * When the `web-search` plugin is absent, or the user turned web search off,
 * there is no tool to join and the contribution is a no-op rather than a
 * diagnostic.
 */
export function webSearchProviderPlugin(provider: WebSearchProvider): Plugin {
  return definePlugin({
    id: `web-search/${provider.id}`,
    session(api) {
      api.tools.add((tools) => {
        if (!tools.has(WEB_SEARCH_TOOL_NAME)) return;
        tools.update(WEB_SEARCH_TOOL_NAME, (tool) => withProvider(tool, provider));
      });
    },
  });
}
