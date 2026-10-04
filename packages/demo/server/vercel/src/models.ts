import { createServerModels } from "./chat.ts";

let resolved: ReturnType<typeof resolveServerModels> | undefined;

export function serverModels() {
  if (resolved) return resolved;
  resolved = resolveServerModels();
  resolved.catch(() => {
    resolved = undefined;
  });

  return resolved;
}

async function resolveServerModels() {
  const models = createServerModels(process.env);
  const configured = process.env.NYTE_MODEL ?? "vercel-ai-gateway/thinkingmachines/inkling";
  const slash = configured.indexOf("/");

  if (slash === -1) throw new Error("NYTE_MODEL must name a known provider/model.");
  const provider = configured.slice(0, slash);
  const signal = AbortSignal.timeout(30_000);

  // Every provider with a credential lists its catalog; the picker shows what the host can run.
  const credentialed = await Promise.all(
    models
      .getProviders()
      .map(async ({ id }) => ((await models.checkAuth(id, { signal })) ? [id] : [])),
  );

  const { aborted, errors } = await models.refresh({ providers: credentialed.flat(), signal });

  const model = models.getModel(provider, configured.slice(slash + 1));

  if (model) return { model, models };

  if (aborted || errors.has(provider))
    throw new Error(`The ${provider} model catalog could not be loaded.`);

  throw new Error("NYTE_MODEL must name a known provider/model.");
}
