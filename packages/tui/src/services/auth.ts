import type { Connection, Login, LoginMethod, ModelCatalogView } from "@nyte-ai/sdk";

type Provider = ModelCatalogView["providers"][number];

export interface LoginDriver {
  readonly signal: AbortSignal;
  open(url: string, code: string | undefined): void;
  paste(message: string, secret: boolean, signal: AbortSignal): Promise<string>;
  choose(
    message: string,
    options: readonly { readonly id: string; readonly label: string }[],
    signal: AbortSignal,
  ): Promise<string>;
  progress(message: string): void;
}

export interface ProviderChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

function signedIn(provider: Provider): boolean {
  return provider.credential === "configured" || provider.credential === "verified";
}

function methodLabel(method: LoginMethod): string {
  return method.kind === "oauth" ? "Sign in with a browser" : "Paste an API key";
}

function authProviderChoices(
  catalog: ModelCatalogView,
  action: "login" | "logout",
): readonly ProviderChoice[] {
  return catalog.providers
    .filter((provider) =>
      action === "login"
        ? provider.methods.length > 0
        : provider.credential !== "missing" && provider.credential !== "unknown",
    )
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

  const providerId =
    input.providerId ?? (await driver.choose("Sign in to a provider", choices, driver.signal));

  const provider = requireProvider(catalog, providerId);
  const first = provider.methods[0];

  if (first === undefined) throw new Error(`${provider.name} has no interactive login methods.`);

  const kind =
    input.method ??
    (provider.methods.length === 1
      ? first.kind
      : await driver.choose(
          `How do you want to sign in to ${provider.name}?`,
          provider.methods.map((method) => ({ id: method.kind, label: methodLabel(method) })),
          driver.signal,
        ));

  const method = provider.methods.find((candidate) => candidate.kind === kind);

  if (method === undefined)
    throw new Error(`Unsupported login method for ${provider.name}: ${kind}`);

  const label =
    (await connection.models.accounts(provider.id)).length === 0
      ? undefined
      : await driver.paste(
          `Label for this ${provider.name} account (optional)`,
          false,
          driver.signal,
        );

  driver.signal.throwIfAborted();
  await runLogin(
    connection.models.login({ provider: provider.id, method, label }),
    driver,
    provider.name,
  );

  return provider;
}

/**
 * Drives a login's steps through the driver until `done`: shows `open`
 * links, asks `paste` and `choose` questions and answers them, and throws
 * on `failed` or when the driver's signal aborts.
 */
export async function runLogin(login: Login, driver: LoginDriver, name: string): Promise<void> {
  const steps = login.steps()[Symbol.asyncIterator]();
  const failure = Promise.withResolvers<never>();
  failure.promise.catch(() => undefined);
  const cancel = (): void => failure.reject(new Error("Authentication cancelled."));
  driver.signal.addEventListener("abort", cancel, { once: true });

  let prompt = new AbortController();

  try {
    for (;;) {
      const next = await Promise.race([steps.next(), failure.promise]);

      if (next.done === true) throw new Error(`${name} login ended without an answer.`);
      const step = next.value;
      prompt.abort();
      prompt = new AbortController();
      const { signal } = prompt;

      switch (step.kind) {
        case "open":
          driver.open(step.url, step.code);
          break;
        case "paste":
        case "choose":
          (step.kind === "paste"
            ? driver.paste(step.message, step.secret, signal)
            : driver.choose(step.message, step.options, signal)
          )
            .then((answer) => (signal.aborted ? undefined : login.answer(answer)))
            .catch((error) => {
              if (!signal.aborted) failure.reject(error);
            });
          break;
        case "waiting":
          driver.progress(`Waiting for ${name}…`);
          break;
        case "done":
          return;
        case "failed":
          throw new Error(step.reason);
        default: {
          const _exhaustive: never = step;

          return _exhaustive;
        }
      }
    }
  } finally {
    prompt.abort();
    driver.signal.removeEventListener("abort", cancel);
    void steps.return?.();
  }
}

export async function logoutProvider(input: {
  readonly connection: Connection;
  readonly driver: LoginDriver;
  readonly providerId?: string;
}): Promise<{ readonly provider: Provider; readonly message: string }> {
  const { connection, driver } = input;
  const catalog = await connection.models.list();
  const choices = authProviderChoices(catalog, "logout");

  if (input.providerId === undefined && choices.length === 0)
    throw new Error(
      catalog.providers.some((provider) => provider.credential === "unknown")
        ? "Provider sign-in status is unknown."
        : "No stored credentials found.",
    );

  const providerId =
    input.providerId ?? (await driver.choose("Remove a stored credential", choices, driver.signal));

  const provider = requireProvider(catalog, providerId);

  if (provider.credential === "unknown")
    throw new Error(`Sign-in status for ${provider.name} is unknown.`);

  if (provider.credential === "missing")
    throw new Error(`No stored credential for ${provider.name}.`);
  await connection.models.logout(provider.id);

  return { provider, message: `Signed out of ${provider.name}.` };
}
