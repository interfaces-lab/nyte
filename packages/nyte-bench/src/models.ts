import process from "node:process";
import { nyteProviders } from "@nyte-ai/ai";
import { defaultProviderAuthContext } from "@nyte-ai/ai/auth/context";
import { createModels } from "@nyte-ai/ai/models";
import type { MutableModels } from "@nyte-ai/ai/models";
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

/** Models over the Nyte logins of `refs`' providers, refreshed, with every ref known and signed in. */
export async function openModels(refs: readonly ModelRef[]): Promise<MutableModels> {
  const providers = [...new Set(refs.map((ref) => ref.provider))];

  const models = createModels({
    credentials: await readNyteLogins(providers),
    authContext: defaultProviderAuthContext(),
    catalog: { url: process.env.NYTE_MODELS_URL },
  });

  for (const provider of nyteProviders()) models.setProvider(provider);

  await models.refresh({ providers });

  for (const ref of refs) {
    if (models.getModel(ref.provider, ref.id) === undefined)
      throw new Error(`${ref.provider} has no model ${ref.id}.`);

    if ((await models.checkAuth(ref.provider)) === undefined)
      throw new Error(
        `${ref.provider} has no credential. Sign in to it in Nyte, or set its API key (ANTHROPIC_API_KEY for anthropic).`,
      );
  }

  return models;
}
