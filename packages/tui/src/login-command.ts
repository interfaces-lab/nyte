import process from "node:process";
import type { Connection, LoginMethod } from "@nyte-ai/sdk";
import { CliError } from "./cli/errors.ts";
import { formatCommand } from "./cli/format.ts";
import type { Mode } from "./cli/mode.ts";
import { parseCommandArgs } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";
import { readStdin } from "./flags.ts";
import { cliLoginDriver } from "./interaction.ts";
import { describeLogout, loginProvider, logoutProvider } from "./services/auth.ts";
import type { LoginDriver } from "./services/auth.ts";

interface AuthInput {
  readonly args: readonly string[];
  readonly output: Output;
  readonly signal: AbortSignal;
  readonly connection: () => Promise<Connection>;
}

/** The prompt's Ctrl+C, Esc and Ctrl+D end the run the way a signal does: exit 130, nothing printed. */
const interrupt = (): void => void process.emit("SIGINT");

/**
 * `nyte login [<PROVIDER>] [--method oauth|api_key] [--key -] [--label <LABEL>] [--no-open]`.
 * Prompts need an interactive terminal; `--key -` reads an API key from piped stdin instead. The
 * browser opens only when `mode.browser`; with `--no-open` or over SSH the link is printed and the
 * provider's copy-code or device-code flow runs instead. A piped key has no one to ask for a
 * login name, so it takes the provider's default name. The host bounds the wait: it ends a sign-in
 * that isn't finished after 10 minutes. A failed sign-in gets this command as its retry.
 */
export async function loginCommand(input: AuthInput): Promise<void> {
  const args = parseCommandArgs("login", input.args, 1);
  const providerId = args.positionals[0];
  const keyOption = args.value("key");
  const method = parseMethod(args.value("method"), keyOption !== undefined);
  const out = input.output;
  const open = !args.has("no-open") && out.mode.browser;

  if (keyOption === undefined && !out.mode.interactive)
    throw new CliError("missing_input", "Can't sign in without an interactive terminal.", {
      next: [
        {
          label: "Sign in with an API key piped on stdin",
          argv: ["nyte", "login", providerId ?? "<PROVIDER>", "--key", "-"],
        },
        { label: "Run it in a terminal", argv: ["nyte", "login", ...input.args] },
      ],
    });

  const key =
    keyOption === undefined
      ? undefined
      : await readKey(keyOption, providerId, out.mode, input.signal);

  input.signal.throwIfAborted();
  const host = await input.connection();
  const prompts = cliLoginDriver(out.mode, input.signal, interrupt, open);

  const provider = await loginProvider({
    connection: host,
    driver: key === undefined ? prompts : answerKey(prompts, key),
    providerId,
    method,
    label: args.value("label") ?? (key === undefined ? undefined : ""),
    browser: open ? "host" : "elsewhere",
  }).catch((error: unknown) => {
    if (!(error instanceof CliError) || error.reason !== "failed") throw error;

    throw new CliError("failed", error.message, {
      details: error.details,
      next: [{ label: "Try again", argv: ["nyte", "login", ...input.args] }],
    });
  });

  out.status("done", `Signed in to ${provider.name}`);

  if (!out.mode.tty.stdout || !out.mode.interactive) out.result(`${provider.id}\n`);
  out.progress(`Loading ${provider.name}'s models…`);

  const reloaded = await host.models.refresh(provider.id).then(
    () => true,
    () => false,
  );

  input.signal.throwIfAborted();
  out.say("");

  if (!reloaded) {
    out.status("warn", "Saved the login, but couldn't reload the model catalog.");
    out.say("");
    out.say("  Reload it:");
    out.say(formatCommand(["nyte", "update", "--models"], out.mode.stderr));

    return;
  }

  out.say("  Start a chat:");
  out.say(formatCommand(["nyte"], out.mode.stderr));
}

/** `nyte logout [<PROVIDER>]`: removes the provider's active saved login and says what still signs it in. */
export async function logoutCommand(input: AuthInput): Promise<void> {
  const args = parseCommandArgs("logout", input.args, 1);
  const providerId = args.positionals[0];
  const out = input.output;

  if (providerId === undefined && !out.mode.interactive)
    throw new CliError(
      "missing_input",
      "Can't choose a provider without an interactive terminal.",
      { next: [{ label: "Name the provider", argv: ["nyte", "logout", "<PROVIDER>"] }] },
    );

  input.signal.throwIfAborted();

  const receipt = await logoutProvider({
    connection: await input.connection(),
    driver: cliLoginDriver(out.mode, input.signal, interrupt),
    providerId,
  });

  const described = describeLogout(receipt);
  out.status("done", described.done);
  out.rows(described.left);

  if (!out.mode.tty.stdout || !out.mode.interactive) out.result(`${receipt.provider.id}\n`);
}

/**
 * The key piped to stdin for `--key -`, minus one trailing newline. The key is never an argument,
 * and no error here repeats `--key`'s value, which may be a key typed by mistake.
 */
async function readKey(
  option: string,
  providerId: string | undefined,
  mode: Mode,
  signal: AbortSignal,
): Promise<string> {
  const piped = ["nyte", "login", providerId ?? "<PROVIDER>", "--key", "-"];

  if (option !== "-")
    throw new CliError(
      "invalid_arguments",
      "Can't take an API key as an argument. Pipe it to --key -.",
      {
        next: [{ label: "Pipe the key", argv: piped }],
      },
    );

  if (providerId === undefined)
    throw new CliError("missing_input", "Can't choose a provider for a piped key.", {
      next: [{ label: "Name the provider", argv: piped }],
    });

  if (mode.tty.stdin)
    throw new CliError(
      "invalid_arguments",
      "Can't read a key from a terminal. Pipe the key, or run without --key to type it at a masked prompt.",
      {
        next: [
          {
            label: "Type it at a prompt",
            argv: ["nyte", "login", providerId, "--method", "api_key"],
          },
        ],
      },
    );

  const key = await readStdin(false, signal);

  if (key === "")
    throw new CliError("missing_input", "Can't sign in with an empty key from stdin.", {
      next: [{ label: "Pipe the key", argv: piped }],
    });

  return key;
}

/** Answers the provider's secret prompt once with the piped key. Anything else it asks needs a terminal, which the prompts refuse. */
function answerKey(prompts: LoginDriver, key: string): LoginDriver {
  let unused = true;

  return {
    ...prompts,
    paste(message, secret, superseded) {
      if (!secret || !unused) return prompts.paste(message, secret, superseded);
      unused = false;

      return Promise.resolve(key);
    },
  };
}

function parseMethod(value: string | undefined, piped: boolean): LoginMethod["kind"] | undefined {
  if (value === undefined) return piped ? "key" : undefined;

  if (value === "api_key") return "key";

  if (value === "oauth" && piped)
    throw new CliError("invalid_arguments", "Can't use --key with --method oauth.", {
      next: [{ label: "See the options", argv: ["nyte", "login", "--help"] }],
    });

  if (value === "oauth") return "oauth";

  throw new CliError("invalid_arguments", `--method takes oauth or api_key, not ${value}.`, {
    next: [{ label: "See the options", argv: ["nyte", "login", "--help"] }],
  });
}
