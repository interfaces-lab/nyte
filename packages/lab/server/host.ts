import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNyteModels } from "@nyte-ai/ai";
import type { Host, Plugin, Store } from "@nyte-ai/core";
import { sqliteStore } from "@nyte-ai/host";
import type { ConfigurationPatch, ModelRef } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk";

export const CACHE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/.cache/nyte-lab",
);

export interface ReviewHost {
  readonly sdk: Host;
  readonly store: Store;
  readonly config: ConfigurationPatch;
  close(): Promise<void>;
}

export async function findModel(host: Host, requested?: string): Promise<ModelRef> {
  const catalog = await host.models.list();

  if (requested === undefined || requested === "") {
    if (catalog.default !== null) return catalog.default;
    throw new Error("No signed-in model. Sign in with `nyte`, or set NYTE_LAB_MODEL.");
  }

  const model = catalog.providers
    .flatMap((provider) => provider.models)
    .find(
      (entry) =>
        `${entry.ref.provider}/${entry.ref.id}` === requested ||
        (entry.fast !== null && `${entry.fast.provider}/${entry.fast.id}` === requested),
    );

  if (model === undefined) throw new Error(`No model ${requested} is available.`);

  return model.fast !== null && `${model.fast.provider}/${model.fast.id}` === requested
    ? model.fast
    : model.ref;
}

export async function openReviewHost(options: {
  readonly plugins: readonly Plugin<"core">[];
}): Promise<ReviewHost> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const store = sqliteStore({ path: join(CACHE_DIR, "review.db") });
  const models = createNyteModels();
  let host: Host | undefined;

  try {
    const signedIn = (
      await Promise.all(
        models
          .getProviders()
          .map(async (provider) =>
            (await models.checkAuth(provider.id)) === undefined ? [] : [provider.id],
          ),
      )
    ).flat();

    await models.refresh({ providers: signedIn });
    host = await sdk.open({
      store,
      models,
      workspace: { kind: "local", path: process.cwd() },
      plugins: options.plugins,
    });
    const model = await findModel(host, process.env["NYTE_LAB_MODEL"]);
    const effort = process.env["NYTE_LAB_EFFORT"];

    const thinking = (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).find(
      (level) => level === effort,
    );

    const opened = host;
    const config: ConfigurationPatch = thinking === undefined ? { model } : { model, thinking };

    return {
      sdk: opened,
      store,
      config,
      async close() {
        try {
          await opened.close();
        } finally {
          await store.close();
        }
      },
    };
  } catch (cause) {
    try {
      await host?.close();
    } finally {
      await store.close();
    }

    throw cause;
  }
}
