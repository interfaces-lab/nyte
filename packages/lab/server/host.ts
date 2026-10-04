/**
 * Real core for the lab: the host composition the terminal and `nyte serve`
 * use, with the caller's plugins only, signed in with `~/.nyte`'s credentials
 * and the user's default model. History lives in one SQLite file under the
 * lab's cache, so a guide written once survives a restart.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNyteModels, type MutableModels } from "@nyte-ai/ai";
import { isThinkingLevel, type Nyte, type Plugin } from "@nyte-ai/core";
import type { RunConfig } from "@nyte-ai/protocol";
import { SqliteStore } from "@nyte-ai/core/store";
import { createHost, resolveModel } from "@nyte-ai/host";
import { createModelPreferencesStore, readCatalog } from "@nyte-ai/host/catalog";

/** Where the lab keeps what outlives a dev server: the core store and the review registry. */
export const CACHE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/.cache/nyte-lab",
);

const STORE_PATH = join(CACHE_DIR, "review.db");

export interface ReviewHost {
  readonly sdk: Nyte;
  readonly store: SqliteStore;
  readonly models: MutableModels;
  /** What a new brief pins; every fork then pins what its parent ran. */
  readonly config: RunConfig;
  close(): Promise<void>;
}

/** The default a new chat would start with, or `NYTE_LAB_MODEL` as `provider/id`. */
async function chooseModel(models: MutableModels) {
  const requested = process.env["NYTE_LAB_MODEL"];

  if (requested !== undefined && requested !== "") return resolveModel(models, requested);

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
  const { defaultModel } = await readCatalog(models, await createModelPreferencesStore().read());

  if (defaultModel === undefined)
    throw new Error("No signed-in model. Sign in with `nyte`, or set NYTE_LAB_MODEL.");

  return defaultModel;
}

export async function openReviewHost(options: {
  readonly plugins: readonly Plugin[];
  readonly onDiagnostic: (message: string) => void;
}): Promise<ReviewHost> {
  const models = createNyteModels();
  const model = await chooseModel(models);
  const effort = process.env["NYTE_LAB_EFFORT"];
  const preferences = await createModelPreferencesStore().read();

  const thinkingLevel =
    effort !== undefined && isThinkingLevel(effort) ? effort : preferences.defaults.thinkingLevel;

  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const store = new SqliteStore(STORE_PATH);
  let sdk: Nyte;

  try {
    sdk = await createHost({
      store,
      models,
      model,
      thinkingLevel,
      onDiagnostic: (diagnostic) =>
        options.onDiagnostic(`${diagnostic.operation} failed: ${String(diagnostic.cause)}`),
      plugins: { kind: "custom", cwd: process.cwd(), plugins: options.plugins },
    });
  } catch (cause) {
    await store.close().catch(() => undefined);
    throw cause;
  }

  const detach = sdk.attach();

  return {
    sdk,
    store,
    models,
    config: { model: { provider: model.provider, id: model.id }, thinkingLevel },
    async close() {
      detach();
      await sdk.close();
      await store.close();
    },
  };
}
