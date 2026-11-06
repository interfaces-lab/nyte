import { join } from "node:path";
import process from "node:process";
import { FileModelsStore, nyteProviders } from "@nyte-ai/ai";
import { defaultProviderAuthContext } from "@nyte-ai/ai/auth/context";
import { createModels } from "@nyte-ai/ai/models";
import type { MutableModels, Provider } from "@nyte-ai/ai/models";
import type { ModelRef } from "@nyte-ai/schema";
import { readNyteLogins } from "./login.ts";

/** The models a run compares when it names none: Anthropic's and OpenAI's current tiers, on the logins Nyte holds. */
export const LINEUP: readonly ModelRef[] = [
  { provider: "anthropic", id: "claude-haiku-5-5" },
  { provider: "anthropic", id: "claude-sonnet-5-5" },
  { provider: "openai-codex", id: "gpt-5.6-luna" },
  { provider: "openai-codex", id: "gpt-5.6-sol" },
  { provider: "openai-codex", id: "gpt-6-luna" },
  { provider: "openai-codex", id: "gpt-6.1-sol" },
  { provider: "openai-codex", id: "gpt-6-astra" },
];

/** `provider/id`, or an id alone that names one model of the lineup. */
export function parseModel(name: string): ModelRef {
  const slash = name.indexOf("/");

  if (slash !== -1) return { provider: name.slice(0, slash), id: name.slice(slash + 1) };
  const known = LINEUP.find((ref) => ref.id === name);

  if (known === undefined) throw new Error(`${name} is not in the lineup; name it as provider/id.`);

  return known;
}

/** Builds one sample's models, each provider passed through `wrap`. */
export type ModelsFactory = (wrap: (provider: Provider) => Provider) => Promise<MutableModels>;

/**
 * Refreshes the catalogs of `refs`' providers once into a models store in `folder`, checks that
 * every ref is known and signed in, and returns a factory for each sample's own models: they
 * share the Nyte logins and restore the stored catalogs without the network.
 */
export async function openCatalog(
  refs: readonly ModelRef[],
  folder: string,
): Promise<ModelsFactory> {
  const providers = [...new Set(refs.map((ref) => ref.provider))];
  const credentials = await readNyteLogins(providers);
  const modelsStore = new FileModelsStore(join(folder, "models-store.json"));

  const build = async (wrap: (provider: Provider) => Provider, allowNetwork: boolean) => {
    const models = createModels({
      credentials,
      modelsStore,
      authContext: defaultProviderAuthContext(),
      catalog: { url: process.env.NYTE_MODELS_URL },
    });

    for (const provider of nyteProviders()) models.setProvider(wrap(provider));
    await models.refresh({ providers, allowNetwork });

    return models;
  };

  const first = await build((provider) => provider, true);

  for (const ref of refs) {
    if (first.getModel(ref.provider, ref.id) === undefined)
      throw new Error(`${ref.provider} has no model ${ref.id}.`);

    if ((await first.checkAuth(ref.provider)) === undefined)
      throw new Error(
        `${ref.provider} has no credential. Sign in to it in Nyte, or set its API key (ANTHROPIC_API_KEY for anthropic).`,
      );
  }

  return (wrap) => build(wrap, false);
}
