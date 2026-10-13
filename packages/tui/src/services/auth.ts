/**
 * Sign in and out through the host: the host runs a provider's login and
 * holds the credential; the client draws each step and answers what it asks.
 * The CLI and the full-screen shell differ only in their driver.
 */
import type { Connection, LoginMethod, ModelCatalogView } from "@nyte-ai/sdk";

type Provider = ModelCatalogView["providers"][number];

/** How a client draws a login: a URL to open, text to paste back, one option to pick, progress. */
export interface LoginDriver {
  readonly signal: AbortSignal;
  open(url: string, code: string | undefined): void;
  paste(message: string, secret: boolean): Promise<string>;
  choose(
    message: string,
    options: readonly { readonly id: string; readonly label: string }[],
  ): Promise<string>;
  progress(message: string): void;
}

/** One provider as a picker row; signed-in providers say so. */
export interface ProviderChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

function signedIn(provider: Provider): boolean {
  return provider.credential === "configured" || provider.credential === "verified";
}

function methodLabel(method: LoginMethod): string {
  return method.kind === "oauth" ? "Sign in with a browser" : "API key";
}

/** Returns the providers a login can reach, or the ones a logout can remove a credential from. */
function authProviderChoices(
  catalog: ModelCatalogView,
  action: "login" | "logout",
): readonly ProviderChoice[] {
  return catalog.providers
    .filter((provider) => (action === "login" ? provider.methods.length > 0 : signedIn(provider)))
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      description: action === "login" && signedIn(provider) ? "signed in" : "",
    }));
}

function requireProvider(catalog: ModelCatalogView, id: string): Provider {
  const provider = catalog.providers.find((candidate) => candidate.id === id);

  if (provider === undefined) throw new Error(`Unknown provider: ${id}`);

  return provider;
}

/**
 * Signs in to a provider through the host's login, asking which provider and
 * method when they are not given, and returns the provider once the host
 * says done. Dropping out cancels the attempt, never a saved credential.
 */
export async function loginProvider(input: {
  readonly connection: Connection;
  readonly driver: LoginDriver;
  readonly providerId?: string;
  readonly method?: LoginMethod["kind"];
}): Promise<Provider> {
  const { connection, driver } = input;
  const catalog = await connection.models.list();
  const choices = authProviderChoices(catalog, "login");

  if (input.providerId === undefined && choices.length === 0)
    throw new Error("No providers support interactive login.");
  const providerId = input.providerId ?? (await driver.choose("Sign in to a provider", choices));
  const provider = requireProvider(catalog, providerId);
  const first = provider.methods[0];

  if (first === undefined) throw new Error(`${provider.name} has no interactive login methods.`);

  const kind =
    input.method ??
    (provider.methods.length === 1
      ? first.kind
      : await driver.choose(
          `Sign in to ${provider.name} with`,
          provider.methods.map((method) => ({ id: method.kind, label: methodLabel(method) })),
        ));

  const method = provider.methods.find((candidate) => candidate.kind === kind);

  if (method === undefined)
    throw new Error(`Unsupported login method for ${provider.name}: ${kind}`);
  const login = connection.models.login({ provider: provider.id, method });
  const steps = login.steps()[Symbol.asyncIterator]();

  const aborted = new Promise<"aborted">((resolve) => {
    driver.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });

  try {
    for (;;) {
      const next = await Promise.race([steps.next(), aborted]);

      if (next === "aborted") throw new Error("Authentication cancelled.");

      if (next.done === true) throw new Error(`${provider.name} login ended without an answer.`);
      const step = next.value;

      switch (step.kind) {
        case "open":
          driver.open(step.url, step.code);
          break;
        case "paste":
          await login.answer(await driver.paste(step.message, step.secret));
          break;
        case "choose":
          await login.answer(await driver.choose(step.message, step.options));
          break;
        case "waiting":
          driver.progress("Waiting for the provider…");
          break;
        case "done":
          return provider;
        case "failed":
          throw new Error(step.reason);
        default: {
          const _exhaustive: never = step;

          return _exhaustive;
        }
      }
    }
  } finally {
    void steps.return?.();
  }
}

/** Removes a provider's saved credential, asking which when none is given. */
export async function logoutProvider(input: {
  readonly connection: Connection;
  readonly driver: LoginDriver;
  readonly providerId?: string;
}): Promise<{ readonly provider: Provider; readonly message: string }> {
  const { connection, driver } = input;
  const catalog = await connection.models.list();
  const choices = authProviderChoices(catalog, "logout");

  if (input.providerId === undefined && choices.length === 0)
    throw new Error("No stored credentials found.");

  const providerId =
    input.providerId ?? (await driver.choose("Remove a stored credential", choices));

  const provider = requireProvider(catalog, providerId);

  if (!signedIn(provider)) throw new Error(`No stored credential for ${provider.name}.`);
  await connection.models.logout(provider.id);

  return { provider, message: `Signed out of ${provider.name}.` };
}
