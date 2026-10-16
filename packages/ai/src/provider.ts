/**
 * Building a provider from its auth, catalog source, and API implementations.
 */
import { ModelSchema } from "@nyte-ai/schema/model";
import { Value } from "typebox/value";
import { lazyStream } from "./api/lazy.ts";
import { ModelsError } from "./auth/resolve.ts";
import type { Credential, ProviderAuth } from "./auth/types.ts";
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  PromptCachePolicy,
  ProviderHeaders,
  ProviderStreams,
} from "./types.ts";
import { type Provider } from "./models-types.ts";

export interface CreateProviderOptions<TApi extends Api = Api> {
  id: string;
  /** Display name. Default: `id`. */
  name?: string;
  baseUrl?: string;
  headers?: ProviderHeaders;
  promptCache?: PromptCachePolicy;
  /** Required — every provider has auth semantics, even ambient/keyless ones. */
  auth: ProviderAuth;
  fetchAccountLimits?: Provider<TApi>["fetchAccountLimits"];
  filterModels?: (
    models: readonly Model<TApi>[],
    credential: Credential | undefined,
  ) => readonly Model<TApi>[];
  /** Single implementation, or map keyed by `model.api` for mixed-API providers. */
  api: ProviderStreams | Partial<Record<TApi, ProviderStreams>>;
}

/** Skip the network catalog fetch when the stored one is this fresh, unless forced. */
const CATALOG_FRESHNESS_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Builds a provider from parts. Built-in and custom provider factories both go through this. A
 * single `api` streams all models; an `api` map dispatches on `model.api`, and a model whose api
 * has no entry is omitted from the catalog and produces a stream error if passed directly.
 */
export function createProvider<TApi extends Api = Api>(
  input: CreateProviderOptions<TApi>,
): Provider<TApi> {
  let catalogModels: readonly Model<TApi>[] = [];
  const api = input.api;
  const single = "streamSimple" in api ? api : undefined;

  const byApi = new Map(
    "streamSimple" in api ? [] : Object.entries<ProviderStreams | undefined>(api),
  );

  const apiFor = (model: Model<Api>): ProviderStreams | undefined => single ?? byApi.get(model.api);

  const usableModels = (catalog: readonly unknown[]): readonly Model<TApi>[] =>
    catalog.filter(
      (model): model is Model<TApi> =>
        Value.Check(ModelSchema, model) &&
        model.provider === input.id &&
        apiFor(model) !== undefined,
    );

  const dispatch = (
    model: Model<Api>,
    run: (streams: ProviderStreams) => AssistantMessageEventStream,
  ): AssistantMessageEventStream => {
    const streams = apiFor(model);

    if (!streams) {
      return lazyStream(model, async () => {
        throw new ModelsError(
          "stream",
          `Provider ${input.id} has no API implementation for "${model.api}"`,
        );
      });
    }

    return run(streams);
  };

  const provider: Provider<TApi> = {
    id: input.id,
    name: input.name ?? input.id,
    baseUrl: input.baseUrl,
    headers: input.headers,
    promptCache: input.promptCache,
    auth: input.auth,
    fetchAccountLimits: input.fetchAccountLimits,
    getModels: () => catalogModels,
    refreshModels: async (context) => {
      if (context.stored) {
        const restored = usableModels(context.stored.models);

        if (
          !(await context.publish({
            update: () => {
              catalogModels = restored;
            },
          }))
        ) {
          return;
        }
      }

      if (!context.allowNetwork || context.signal.aborted) return;

      if (
        context.force !== true &&
        context.stored?.checkedAt !== undefined &&
        Date.now() - context.stored.checkedAt < CATALOG_FRESHNESS_WINDOW_MS
      ) {
        return;
      }

      const headers = new Headers({ Accept: "application/json" });

      if (context.stored?.etag !== undefined) {
        headers.set("If-None-Match", context.stored.etag);
      }

      let response: Response;

      try {
        response = await context.catalog.fetch(
          `${context.catalog.url.replace(/\/+$/u, "")}/${input.id}.json`,
          {
            headers,
            signal: context.signal,
            redirect: "error",
          },
        );
      } catch (error) {
        context.signal.throwIfAborted();
        throw new ModelsError("model_source", `Model catalog request failed for ${input.id}`, {
          cause: error,
        });
      }

      const checkedAt = Date.now();

      if (response.status === 304) {
        if (!context.stored) {
          throw new ModelsError(
            "model_source",
            `Model catalog request failed for ${input.id} (HTTP 304 without cached models)`,
          );
        }

        await context.publish({ persist: { ...context.stored, checkedAt } });

        return;
      }

      if (response.status !== 200) {
        throw new ModelsError(
          "model_source",
          `Model catalog request failed for ${input.id} (HTTP ${String(response.status)})`,
        );
      }

      let value: unknown;

      try {
        value = await response.json();
      } catch {
        throw new ModelsError(
          "model_source",
          `Model catalog request failed for ${input.id} (HTTP 200, invalid JSON)`,
        );
      }

      if (!Array.isArray(value)) {
        throw new ModelsError(
          "model_source",
          `Model catalog request failed for ${input.id} (HTTP 200, expected an array)`,
        );
      }

      const refreshed = usableModels(value);

      const lastModifiedHeader = response.headers.get("Last-Modified");

      const parsedLastModified =
        lastModifiedHeader === null ? undefined : Date.parse(lastModifiedHeader);

      const lastModified =
        parsedLastModified === undefined || Number.isNaN(parsedLastModified)
          ? undefined
          : parsedLastModified;

      if (context.signal.aborted) return;
      await context.publish({
        persist: {
          models: value,
          etag: response.headers.get("ETag") ?? undefined,
          lastModified,
          checkedAt,
        },
        update: () => {
          catalogModels = refreshed;
        },
      });
    },
    filterModels: input.filterModels,
    stream: (model, context, options) =>
      dispatch(model, (streams) => streams.stream(model, context, options)),
    streamSimple: (model, context, options) =>
      dispatch(model, (streams) => streams.streamSimple(model, context, options)),
  };

  const streams = single ? [single] : [...byApi.values()].filter((entry) => entry !== undefined);

  if (streams.some((entry) => entry.fetchDeferred !== undefined)) {
    provider.fetchDeferred = (model, handle, options) =>
      lazyStream(model, async () => {
        const implementation = apiFor(model);

        if (!implementation?.fetchDeferred) {
          throw new ModelsError(
            "provider",
            `Provider ${input.id} does not support deferred responses for "${model.api}"`,
          );
        }

        return implementation.fetchDeferred(model, handle, options);
      });
  }

  if (streams.some((entry) => entry.cancelDeferred !== undefined)) {
    provider.cancelDeferred = async (model, handle, options) => {
      const implementation = apiFor(model);

      if (!implementation?.cancelDeferred) {
        throw new ModelsError(
          "provider",
          `Provider ${input.id} cannot cancel deferred responses for "${model.api}"`,
        );
      }

      await implementation.cancelDeferred(model, handle, options);
    };
  }

  return provider;
}
