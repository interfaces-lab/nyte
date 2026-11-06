import type { Connection, Login, LoginMethod, ModelCatalogView } from "@nyte-ai/sdk";
import { CliError, suggest } from "../cli/errors.ts";
import type { DetailRow, NextStep } from "../cli/errors.ts";
import { printable } from "../cli/format.ts";

type Provider = ModelCatalogView["providers"][number];

/** A choice the driver lists; `description` is context such as `signed in`, shown beside the label. */
export interface Choice {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface LoginDriver {
  readonly signal: AbortSignal;
  open(url: string, code: string | undefined): void;
  paste(message: string, secret: boolean, signal: AbortSignal): Promise<string>;
  choose(message: string, options: readonly Choice[], signal: AbortSignal): Promise<string>;
  progress(message: string): void;
}

/** What a logout removed, and what still signs the provider in. */
export interface LogoutReceipt {
  readonly provider: Pick<Provider, "id" | "name">;
  /** The label of the saved login it removed. */
  readonly removed: string;
  readonly left:
    | { readonly kind: "nothing" }
    /** Other saved logins stay, none of them active, so the provider is signed out. */
    | { readonly kind: "saved"; readonly labels: readonly string[] }
    /** A credential from outside Nyte, such as an environment variable, still signs it in. */
    | { readonly kind: "external" };
}

/** A logout receipt in words: the receipt line, then one row per thing left. */
export interface LogoutSummary {
  readonly done: string;
  readonly left: readonly DetailRow[];
}

/** `nyte status` lists every credential; a next step for errors that name a provider. */
const SEE_CREDENTIALS: NextStep = { label: "See your credentials", argv: ["nyte", "status"] };

/** The detail row for a credential `logout` can't remove. */
const EXTERNAL = {
  label: "Still active",
  value: "A credential from outside Nyte, such as an environment variable",
} as const;

function methodLabel(method: LoginMethod): string {
  return method.kind === "oauth" ? "Sign in with a browser" : "Paste an API key";
}

/**
 * `browser` answers the provider's own method question: `host` signs in with a browser on this
 * machine, `elsewhere` with a copy-code or device-code flow for a browser anywhere. Without it the
 * provider asks.
 */
export async function loginProvider(input: {
  readonly connection: Connection;
  readonly driver: LoginDriver;
  readonly providerId?: string;
  readonly method?: LoginMethod["kind"];
  readonly label?: string;
  readonly browser?: "host" | "elsewhere";
}): Promise<Provider> {
  const { connection, driver } = input;
  const catalog = await connection.models.list();

  const choices = catalog.providers
    .filter((provider) => provider.methods.length > 0)
    .map((provider) =>
      provider.credential === "configured" || provider.credential === "verified"
        ? { id: provider.id, label: provider.name, description: "signed in" }
        : { id: provider.id, label: provider.name },
    );

  const providerId =
    input.providerId ?? (await driver.choose("Sign in to which provider?", choices, driver.signal));

  const provider = requireProvider(catalog, providerId, {
    label: "Choose from the list",
    argv: ["nyte", "login"],
  });

  const first = provider.methods[0];

  if (first === undefined)
    throw new CliError("invalid_arguments", `Can't sign in to ${provider.name} with nyte login.`, {
      details: [{ label: "Methods", value: "None" }],
    });

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
    throw new CliError(
      "invalid_arguments",
      `Can't sign in to ${provider.name} with ${kind === "key" ? "an API key" : "a browser"}.`,
      {
        details: [
          {
            label: "Methods",
            value: provider.methods
              .map((candidate) => (candidate.kind === "key" ? "api_key" : "oauth"))
              .join(", "),
          },
        ],
      },
    );

  const label =
    input.label ??
    ((await connection.models.accounts(provider.id)).length === 0
      ? undefined
      : await driver.paste(
          `Name for this ${provider.name} login? (optional)`,
          false,
          driver.signal,
        ));

  driver.signal.throwIfAborted();
  await runLogin(
    connection.models.login({
      provider: provider.id,
      method,
      label: label === "" ? undefined : label,
      browser: input.browser,
    }),
    driver,
    provider.name,
  );

  return provider;
}

/**
 * Drives a login's steps through the driver until `done`: shows `open`
 * links, asks `paste` and `choose` questions and answers them, and throws
 * on `failed` or when the driver's signal aborts. The host ends the steps without an outcome when
 * a sign-in isn't finished within its lifetime (10 minutes).
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

      if (next.done === true)
        throw new CliError(
          "failed",
          `Couldn't sign in to ${name}. The host stopped waiting for it.`,
        );
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
          throw new CliError("failed", `Couldn't sign in to ${name}.`, {
            details: [{ label: "Host reported", value: printable(step.reason) }],
          });
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

/**
 * Removes the provider's active saved login. `models.logout` keeps its other saved logins, and a
 * credential from outside Nyte, such as an environment variable, stays active, so the receipt
 * says what was removed and what is left. Without `providerId` it takes the one provider with an
 * active saved login, and asks only when there are more. Throws without removing anything when the
 * provider has no active saved login.
 */
export async function logoutProvider(input: {
  readonly connection: Connection;
  readonly driver: LoginDriver;
  readonly providerId?: string;
}): Promise<LogoutReceipt> {
  const { connection, driver } = input;
  const catalog = await connection.models.list();
  const saved = await connection.models.accounts();

  const choices = catalog.providers
    .filter((provider) =>
      saved.some((account) => account.provider === provider.id && account.active),
    )
    .map((provider) => ({ id: provider.id, label: provider.name }));

  if (input.providerId === undefined && choices.length === 0)
    throw new CliError("not_found", "Can't remove a saved login. No provider has one.", {
      next: [SEE_CREDENTIALS],
    });

  const only = choices.length === 1 ? choices[0] : undefined;

  const providerId =
    input.providerId ??
    only?.id ??
    (await driver.choose("Remove which provider's saved login?", choices, driver.signal));

  const provider = requireProvider(catalog, providerId, SEE_CREDENTIALS);
  const accounts = saved.filter((account) => account.provider === provider.id);
  const active = accounts.find((account) => account.active);
  const inactive = accounts.filter((account) => !account.active).map((account) => account.label);

  if (active === undefined && inactive.length > 0)
    throw new CliError(
      "conflict",
      `Can't remove ${provider.name}'s saved login. None of its saved logins is active.`,
      { details: [{ label: "Saved", value: quoteLabels(inactive) }] },
    );

  if (active === undefined)
    throw new CliError("not_found", `Can't remove ${provider.name}'s saved login. It has none.`, {
      details: (await stillSignedIn(connection, provider.id)) ? [EXTERNAL] : [],
      next: [SEE_CREDENTIALS],
    });

  await connection.models.logout(provider.id);

  if (inactive.length > 0)
    return { provider, removed: active.label, left: { kind: "saved", labels: inactive } };

  return {
    provider,
    removed: active.label,
    left: (await stillSignedIn(connection, provider.id))
      ? { kind: "external" }
      : { kind: "nothing" },
  };
}

/**
 * A logout receipt as the CLI and the full-screen TUI show it: what was removed, then what is still
 * saved or still signs the provider in.
 */
export function describeLogout(receipt: LogoutReceipt): LogoutSummary {
  const done = `Removed ${receipt.provider.name}'s saved login "${printable(receipt.removed)}"`;

  switch (receipt.left.kind) {
    case "nothing":
      return { done, left: [] };
    case "saved":
      return {
        done,
        left: [
          {
            label: "Still saved",
            value: `${printable(quoteLabels(receipt.left.labels))}, not active`,
          },
        ],
      };
    case "external":
      return { done, left: [EXTERNAL] };
    default: {
      const _exhaustive: never = receipt.left;

      return _exhaustive;
    }
  }
}

/** `"work" and "personal"`, the way receipts and errors list saved logins. */
function quoteLabels(labels: readonly string[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    labels.map((label) => `"${label}"`),
  );
}

/** Ids are exact; a near id is suggested, never used. */
function requireProvider(catalog: ModelCatalogView, id: string, next: NextStep): Provider {
  const provider = catalog.providers.find((candidate) => candidate.id === id);

  if (provider !== undefined) return provider;

  const near = suggest(
    id,
    catalog.providers.map((candidate) => candidate.id),
  );

  throw new CliError(
    "not_found",
    `Couldn't find provider ${id}.${near === undefined ? "" : ` Did you mean ${near}?`}`,
    { next: [next] },
  );
}

/** `models.refresh` settles the credential check even when its model list refresh fails. */
async function stillSignedIn(connection: Connection, providerId: string): Promise<boolean> {
  await connection.models.refresh(providerId).catch(() => undefined);

  const credential = (await connection.models.list()).providers.find(
    (provider) => provider.id === providerId,
  )?.credential;

  return credential === "configured" || credential === "verified";
}
