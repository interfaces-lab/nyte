import { FileCredentialStore } from "@nyte-ai/ai";
import type { AuthInteraction, AuthType, CredentialStore, Models, Provider } from "@nyte-ai/ai";
import { invalidateAuthenticatedModels, providerAuthStatuses, requireProvider } from "./catalog.ts";

/** Only methods with an interactive flow belong in the login picker. */
function loginMethods(provider: Provider) {
  const methods: { id: AuthType; label: string }[] = [];
  if (provider.auth.oauth !== undefined)
    methods.push({
      id: "oauth",
      label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name,
    });
  if (provider.auth.apiKey?.login !== undefined)
    methods.push({ id: "api_key", label: provider.auth.apiKey.name });
  return methods;
}

/** CLI and full-screen clients differ only in how they present provider-owned prompts. */
export async function loginProvider(input: {
  readonly models: Models;
  readonly interaction: AuthInteraction;
  readonly providerId?: string;
  readonly method?: AuthType;
}): Promise<Provider> {
  const controller = new AbortController();
  const signal =
    input.interaction.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, input.interaction.signal]);
  const interaction: AuthInteraction = {
    signal,
    prompt: (prompt) => {
      signal.throwIfAborted();
      return input.interaction.prompt({
        ...prompt,
        signal: prompt.signal === undefined ? signal : AbortSignal.any([signal, prompt.signal]),
      });
    },
    notify: (event) => {
      if (!signal.aborted) input.interaction.notify(event);
    },
  };
  try {
    signal.throwIfAborted();
    const providers =
      input.providerId === undefined
        ? (await providerAuthStatuses(input.models, { signal })).filter(
            (status) => loginMethods(status.provider).length > 0,
          )
        : undefined;
    if (providers?.length === 0) throw new Error("No providers support interactive login.");
    const providerId =
      input.providerId ??
      (await interaction.prompt({
        type: "select",
        message: "Sign in to a provider",
        options: (providers ?? []).map((status) => ({
          id: status.provider.id,
          label: status.provider.name,
          description: status.kind === "authenticated" ? "signed in" : "",
        })),
      }));
    signal.throwIfAborted();
    const provider = requireProvider(input.models, providerId);
    const methods = loginMethods(provider);
    const first = methods[0];
    if (first === undefined) throw new Error(`${provider.name} has no interactive login methods.`);
    const methodId =
      input.method ??
      (methods.length === 1
        ? first.id
        : await interaction.prompt({
            type: "select",
            message: `Sign in to ${provider.name} with`,
            options: methods,
          }));
    const method = methods.find((candidate) => candidate.id === methodId);
    if (method === undefined)
      throw new Error(`Unsupported login method for ${provider.name}: ${methodId}`);
    await input.models.login(provider.id, method.id, interaction);
    invalidateAuthenticatedModels(input.models);
    return provider;
  } finally {
    // Includes provider errors and abandoned callback/device-code waits.
    controller.abort();
  }
}

/** Removal targets stored credentials, not every provider with usable external auth. */
export async function logoutProvider(input: {
  readonly models: Models;
  readonly interaction: AuthInteraction;
  readonly providerId?: string;
  readonly credentials?: CredentialStore;
}): Promise<{ readonly provider: Provider; readonly message: string }> {
  const credentials = input.credentials ?? new FileCredentialStore();
  const options = { signal: input.interaction.signal };
  options.signal?.throwIfAborted();
  // Validate an explicit target before reading or mutating storage.
  if (input.providerId !== undefined) requireProvider(input.models, input.providerId);
  const stored = await credentials.list(options);
  const providers = stored.flatMap((credential) => {
    const provider = input.models.getProvider(credential.providerId);
    return provider === undefined ? [] : [{ provider, credential }];
  });
  if (input.providerId === undefined && providers.length === 0)
    throw new Error("No stored credentials found.");
  const providerId =
    input.providerId ??
    (await input.interaction.prompt({
      type: "select",
      message: "Remove a stored credential",
      options: providers.map(({ provider, credential }) => ({
        id: provider.id,
        label: provider.name,
        description: credential.type === "oauth" ? "OAuth" : "API key",
      })),
    }));
  const provider = requireProvider(input.models, providerId);
  // Re-read after the picker: another client may have removed this credential.
  const credential = await credentials.read(provider.id, options);
  if (credential === undefined) {
    const auth = await input.models.checkAuth(provider.id, options);
    if (auth !== undefined)
      throw new Error(
        `${provider.name} is authenticated through ${auth.source ?? "external configuration"}. Unset or remove that source to disconnect; no stored credential was removed.`,
      );
    throw new Error(`No stored credential for ${provider.name}.`);
  }
  await input.models.logout(provider.id, options);
  invalidateAuthenticatedModels(input.models);
  const removed = `Removed stored credential for ${provider.name}.`;
  try {
    const remaining = await input.models.checkAuth(provider.id, options);
    return {
      provider,
      message:
        remaining === undefined
          ? `Signed out of ${provider.name}.`
          : `${removed} Still authenticated through ${remaining.source ?? "external configuration"}; unset or remove that source to disconnect.`,
    };
  } catch {
    // A post-mutation status failure must not imply that deletion failed.
    return { provider, message: `${removed} Couldn't check remaining authentication.` };
  }
}
