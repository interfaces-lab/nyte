/**
 * `nyte account`: this host profile and the user's Nyte account. Linking
 * is approved from a browser on any device; the broker never sees a password
 * here and the terminal never sees a Clerk credential. Distinct from
 * `nyte login`, which signs in a model provider.
 */
import process from "node:process";
import { parseArgs } from "node:util";
import { ConnectRuntime, ConnectStore, machineName } from "@nyte-ai/connect/host";
import type { ConnectLinking } from "@nyte-ai/connect";
import { ProfileLocked, openProfile, readProfile } from "@nyte-ai/host/runtime";
import type { HostProfile } from "@nyte-ai/host/runtime";
import { CONNECT_UNCONFIGURED, readConnectConfig } from "./connect-config.ts";

export const ACCOUNT_HELP = [
  "Usage: nyte account <login|status|unlink> [--profile <name>] [--name <host name>] [--timeout <seconds>]",
  "Link a host profile to your Nyte account so app.nyte.sh can reach it. Separate from `nyte login`, which signs in a model provider.",
  "login prints a page and a code; sign in there on any device, compare the fingerprint, and approve.",
  "status reports the link. unlink removes this host from the account and refuses its devices.",
  "--profile names the host profile (default: default). login and unlink need it to themselves: stop `nyte serve` on it first.",
  "--name is how the account lists this host (default: this machine's name).",
  "--timeout bounds how long login waits for approval (default: until the request expires, 5 minutes).",
  "Example: nyte account login --profile default",
].join("\n");

export type AccountSubcommand = "login" | "status" | "unlink";

interface AccountArgs {
  readonly command: AccountSubcommand;
  readonly profile: string;
  readonly name: string | undefined;
  readonly timeoutMs: number | undefined;
}

interface Output {
  readonly write: (text: string) => void;
  readonly error: (text: string) => void;
}

export function parseAccountArgs(args: readonly string[]): AccountArgs {
  const { values, positionals } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: true,
    options: {
      profile: { type: "string" },
      name: { type: "string" },
      timeout: { type: "string" },
    },
  });
  const [command, ...rest] = positionals;

  if ((command !== "login" && command !== "status" && command !== "unlink") || rest.length > 0) {
    throw new Error("Usage: nyte account <login|status|unlink>. Run `nyte account --help`.");
  }

  const timeout = values.timeout === undefined ? undefined : Number(values.timeout);

  if (timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0)) {
    throw new Error("--timeout must be a number of seconds above 0. Run `nyte account --help`.");
  }

  return {
    command,
    profile: values.profile ?? "default",
    name: values.name,
    timeoutMs: timeout === undefined ? undefined : timeout * 1000,
  };
}

/** Take the profile for this command, naming who holds it otherwise. */
async function ownedProfile(name: string): Promise<HostProfile> {
  try {
    return await openProfile(name);
  } catch (cause) {
    if (!(cause instanceof ProfileLocked)) throw cause;
    const holder = cause.owner === undefined ? "another process" : `pid ${String(cause.owner.pid)}`;

    throw new Error(
      `Host profile "${name}" is in use by ${holder}. Stop \`nyte serve\` on it, then try again.`,
      { cause },
    );
  }
}

function approvalInstructions(
  opened: Extract<ConnectLinking, { kind: "awaiting_approval" }>,
): string {
  const expires = new Date(opened.expiresAt).toLocaleTimeString();

  return [
    "Approve this host from a browser on any device:",
    `  Open     ${opened.verifyUrl}`,
    `  Code     ${opened.userCode}`,
    `  Compare  fingerprint ${opened.fingerprint}`,
    `Approve only a request you started. This one expires at ${expires}; Ctrl-C cancels.`,
    "",
  ].join("\n");
}

function linkFailureMessage(reason: Extract<ConnectLinking, { kind: "failed" }>["reason"]): string {
  switch (reason) {
    case "cancelled":
      return "Linking was cancelled. Nothing was linked.";
    case "network":
      return "Couldn't reach Nyte Connect. Check the connection, then run `nyte account login` again.";
    case "limit":
      return "This account can't link another host right now. Unlink one you no longer use, then try again.";
    case "owner_disabled":
      return "This Nyte account is locked or disabled, so it can't link hosts.";
    case "session_revoked":
      return "The approving sign-in was revoked. Sign in again in the browser, then run `nyte account login` again.";
    case "denied":
      return "The request was declined in the browser. Nothing was linked.";
    case "expired":
      return "The request expired before it was approved. Run `nyte account login` again.";
    case "refused":
      return "Nyte Connect refused to link this host.";
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

async function login(parsed: AccountArgs, output: Output): Promise<void> {
  const config = readConnectConfig();

  if (config === undefined) throw new Error(CONNECT_UNCONFIGURED);
  const profile = await ownedProfile(parsed.profile);

  const runtime = new ConnectRuntime({
    config,
    home: profile.directory,
    storePath: profile.connectPath,
    authorizer: {
      kind: "transaction",
      onOpened: (opened) => output.write(approvalInstructions(opened)),
    },
    onChange: () => undefined,
    name: parsed.name ?? machineName(),
  });

  const cancel = (): void => void runtime.cancel();
  const timer = parsed.timeoutMs === undefined ? undefined : setTimeout(cancel, parsed.timeoutMs);
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);

  try {
    const view = await runtime.link();

    switch (view.kind) {
      case "linked":
        output.write(
          `Host linked to ${view.owner.label} as "${view.environment.name}".\nShare it with: nyte serve --account --profile ${profile.name}\n`,
        );

        return;
      case "unlinked":
        throw new Error(
          view.linking.kind === "failed"
            ? linkFailureMessage(view.linking.reason)
            : "Linking did not finish.",
        );
      case "unavailable":
        throw new Error(
          view.reason === "origin_changed"
            ? `This host is linked through another Nyte Connect origin. Run \`nyte account unlink\` with that origin first.`
            : `Can't use ${profile.connectPath}. Remove it to start over.`,
        );
      default: {
        const _exhaustive: never = view;

        return _exhaustive;
      }
    }
  } finally {
    clearTimeout(timer);
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await runtime.close();
    await profile.release();
  }
}

async function status(parsed: AccountArgs, output: Output): Promise<void> {
  const profile = await readProfile(parsed.profile);

  if (profile === undefined) {
    throw new Error(
      `Host profile "${parsed.profile}" doesn't exist yet. Run \`nyte serve --profile ${parsed.profile}\` once to create it.`,
    );
  }

  const read = await new ConnectStore(profile.connectPath).read();

  if (read.kind === "failed") throw new Error(`Can't read ${profile.connectPath}.`);
  const { link } = read.file;
  output.write(`Host ${profile.hostId} (profile ${profile.name})\n`);

  if (link === null) {
    output.write("Not linked to a Nyte account. Run `nyte account login`.\n");

    if (read.file.unlinks.length > 0)
      output.write("An earlier unlink is still waiting for Nyte Connect to confirm.\n");

    return;
  }

  output.write(
    `Linked to ${link.owner.label} as "${link.environment.name}" through ${link.origin}\n`,
  );
  output.write(
    read.file.enabled
      ? "Account sharing is on while `nyte serve --account` runs.\n"
      : "Account sharing is off. `nyte serve --account` turns it on.\n",
  );

  for (const device of link.devices) {
    output.write(`Device ${device.id}  ${device.name}  ${device.role}\n`);
  }
}

async function unlink(parsed: AccountArgs, output: Output): Promise<void> {
  const config = readConnectConfig();

  if (config === undefined) throw new Error(CONNECT_UNCONFIGURED);
  const profile = await ownedProfile(parsed.profile);

  const runtime = new ConnectRuntime({
    config,
    home: profile.directory,
    storePath: profile.connectPath,
    authorizer: undefined,
    onChange: () => undefined,
  });

  try {
    const before = await runtime.view();

    if (before.kind === "unavailable") {
      throw new Error(
        before.reason === "origin_changed"
          ? "This host is linked through another Nyte Connect origin; set NYTE_CONNECT_ORIGIN to it to unlink."
          : `Can't use ${profile.connectPath}. Remove it to start over.`,
      );
    }

    if (before.kind === "unlinked") {
      output.write("This host isn't linked to a Nyte account.\n");

      return;
    }

    await runtime.unlink();
    const after = await runtime.view();
    const pending = after.kind === "unlinked" && after.notice.kind === "unlink_pending";
    output.write(
      pending
        ? `Unlinked here. Nyte Connect hasn't confirmed yet; this host retries the next time it links or serves.\n`
        : `Unlinked from ${before.owner.label}.\n`,
    );
  } finally {
    await runtime.close();
    await profile.release();
  }
}

export async function accountCommand(args: readonly string[], output: Output): Promise<void> {
  const parsed = parseAccountArgs(args);

  switch (parsed.command) {
    case "login":
      return login(parsed, output);
    case "status":
      return status(parsed, output);
    case "unlink":
      return unlink(parsed, output);
    default: {
      const _exhaustive: never = parsed.command;

      return _exhaustive;
    }
  }
}
