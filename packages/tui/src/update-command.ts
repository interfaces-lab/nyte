import type { Connection } from "@nyte-ai/sdk";
import { valid } from "semver";
import { CliError } from "./cli/errors.ts";
import { formatCommand, printable } from "./cli/format.ts";
import type { Row } from "./cli/format.ts";
import { parseCommandArgs } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";
import { confirm } from "./cli/prompt.ts";
import { errorMessage } from "./lib/format.ts";
import { describeUpdateOutcome, latestReleaseText, selfUpdate } from "./update.ts";
import type { UpdateOutcome, UpdateProgress } from "./update.ts";
import { findUpdate, followedChannel } from "./releases.ts";
import type { UpdateChannel } from "./releases.ts";
import { VERSION } from "./version.ts";

type UpdateRequest =
  | { readonly kind: "check" }
  | { readonly kind: "models" }
  /**
   * A version (a leading `v` is fine), `stable` or `nightly`; none follows the saved channel. `yes`
   * installs a named version older than this build without asking; a channel never needs it.
   */
  | { readonly kind: "install"; readonly target?: string; readonly yes: boolean };

const HELP = { next: [{ label: "See the options", argv: ["nyte", "update", "--help"] }] };

/** `nyte update [<VERSION> | stable | nightly] [--check | --models]`. */
export async function updateCommand(input: {
  readonly args: readonly string[];
  readonly output: Output;
  readonly signal: AbortSignal;
  readonly connection: () => Promise<Connection>;
}): Promise<void> {
  const request = parseUpdateArgs(input.args);

  switch (request.kind) {
    case "check":
      return check(input.output, input.signal);
    case "models":
      return refreshModels(input.output, await input.connection(), input.signal);
    case "install":
      return install(input.output, request, input.signal);
    default: {
      const _exhaustive: never = request;

      return _exhaustive;
    }
  }
}

function parseUpdateArgs(args: readonly string[]): UpdateRequest {
  const parsed = parseCommandArgs("update", args, 1);
  const target = parsed.positionals[0];

  const chosen = [
    ...(target === undefined ? [] : [target]),
    ...(parsed.has("check") ? ["--check"] : []),
    ...(parsed.has("models") ? ["--models"] : []),
  ];

  if (chosen.length > 1)
    throw new CliError("invalid_arguments", `Can't combine ${chosen.join(" and ")}.`, {
      ...HELP,
      details: [{ label: "Choose one", value: "A version, stable, nightly, --check or --models" }],
    });

  if (parsed.has("check")) return { kind: "check" };

  if (parsed.has("models")) return { kind: "models" };

  if (target === undefined) return { kind: "install", yes: parsed.has("yes") };

  if (target === "stable" || target === "nightly" || valid(target.replace(/^v/u, "")) !== null)
    return { kind: "install", target, yes: parsed.has("yes") };

  throw new CliError(
    "invalid_arguments",
    `Can't update to ${target}. Name a version like ${VERSION}, stable or nightly.`,
    HELP,
  );
}

/** Ctrl+C before anything changed. The invocation prints it and exits 130. */
const CANCELED = new CliError("canceled", "Canceled.");

/** The answer goes to stdout; a failed check throws, so "latest" always means GitHub said so. */
async function check(out: Output, signal: AbortSignal): Promise<void> {
  const release = await findUpdate(signal).catch((cause: unknown) => {
    throw signal.aborted ? CANCELED : cause;
  });

  if (release === undefined) {
    out.result(`${latestReleaseText(await followedChannel())}\n`);

    return;
  }

  out.result(`Update available: ${release.version}\n`);
  out.say("");
  out.say("  Install it:");
  out.say(formatCommand(["nyte", "update"], out.mode.stderr));
}

/**
 * Progress is one redrawn line on an interactive terminal and one line per phase otherwise; the
 * percentage comes from the download's Content-Length and shows only when redrawn. A named version
 * older than this build needs a yes or `--yes` before the download starts; a channel only installs
 * an upgrade, which never asks. A saved channel is reported even when the lookup after it fails.
 */
async function install(
  out: Output,
  request: Extract<UpdateRequest, { readonly kind: "install" }>,
  signal: AbortSignal,
): Promise<void> {
  const target = request.target;
  let installing: string | undefined;
  let switched: UpdateChannel | undefined;

  const report = (event: UpdateProgress): void => {
    switch (event.kind) {
      case "checking":
        out.progress(`Checking for the latest ${event.channel} release…`);

        return;
      case "switched":
        switched = event.channel;

        return;
      case "downloading":
        installing = event.version;
        out.progress(`Downloading nyte ${event.version}…`);

        return;
      case "percent":
        out.progress(
          installing === undefined ? "Downloading…" : `Downloading nyte ${installing}…`,
          `${String(event.percent)}%`,
        );

        return;
      case "verified":
        out.progress("Installing…");

        return;
      default: {
        const _exhaustive: never = event;

        return _exhaustive;
      }
    }
  };

  const outcome = await selfUpdate({
    target,
    report,
    signal,
    confirmDowngrade: (version) => confirmDowngrade(out, version, request.yes, signal),
  });

  switch (outcome.kind) {
    case "updated":
      out.rows([
        { gutter: "done", label: "Updated nyte", value: `${outcome.from} → ${outcome.to}` },
        { label: "Path", value: outcome.path },
      ]);
      out.say("");
      out.say(`  Running nyte processes keep ${outcome.from} until they restart.`);

      if (switched !== undefined) out.say(`  Later updates follow the ${switched} channel.`);

      if (!out.mode.tty.stdout || !out.mode.interactive) out.result(`${outcome.to}\n`);

      return;
    case "current":
      out.say(`nyte ${outcome.version} is already installed.`);

      return;
    case "waiting":
      return waiting(
        out,
        outcome,
        target === undefined ? "follow" : switched === undefined ? "already" : "switched",
      );
    case "unsupported":
      throw outcome.blocker === "source"
        ? new CliError("failed", "Can't update nyte when it runs from source.", {
            next: [{ label: "Update the checkout instead", argv: ["git", "pull"] }],
          })
        : new CliError("failed", describeUpdateOutcome(outcome));
    case "failed":
      if (switched !== undefined) out.status("done", `Switched to the ${switched} channel`);

      if (signal.aborted) throw CANCELED;

      throw new CliError(
        "failed",
        installing === undefined
          ? "Failed to update nyte."
          : `Failed to update nyte to ${installing}.`,
        {
          details: [{ label: "Cause", value: printable(outcome.message) }],
          next: [
            {
              label: "Try the update again",
              argv: ["nyte", "update", ...(target === undefined ? [] : [target])],
            },
          ],
        },
      );
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

/**
 * Nothing on the followed channel is newer than this build. `follow` is a bare `nyte update`;
 * `switched` and `already` answer `nyte update <channel>`, which saved the channel either way.
 */
function waiting(
  out: Output,
  outcome: Extract<UpdateOutcome, { readonly kind: "waiting" }>,
  how: "follow" | "switched" | "already",
): void {
  const channel = outcome.channel;

  if (how === "follow") {
    out.say(latestReleaseText(channel));

    return;
  }

  if (how === "already") {
    const newer =
      outcome.newest === VERSION
        ? latestReleaseText(channel)
        : `${VERSION} is newer than the newest ${channel} release.`;

    out.say(`Already on the ${channel} channel. ${newer} Nothing changed.`);

    return;
  }

  out.status("done", `Switched to the ${channel} channel`);
  out.rows([
    { label: `Newest ${channel}`, value: outcome.newest },
    { label: "This build", value: VERSION },
  ]);
  out.say("");
  out.say(
    `  Nothing was installed. nyte update installs the first ${channel} release newer than this build.`,
  );

  if (!out.mode.tty.stdout || !out.mode.interactive) out.result(`${channel}\n`);
}

/**
 * The destructive tier for a named version: an older nyte may not open data a newer one saved. On
 * a terminal it warns and asks; otherwise only `--yes` goes ahead.
 */
async function confirmDowngrade(
  out: Output,
  version: string,
  yes: boolean,
  signal: AbortSignal,
): Promise<void> {
  const risk = `${version} is older than ${VERSION} and may not open data ${VERSION} saved.`;

  if (!yes && !out.mode.interactive)
    throw new CliError(
      "missing_input",
      `Can't install ${version} over ${VERSION} without --yes in non-interactive mode.`,
      {
        details: [{ label: "Why", value: risk }],
        next: [
          {
            label: "Only after a human approves, install the older version",
            argv: ["nyte", "update", version, "--yes"],
          },
        ],
      },
    );

  out.status("warn", risk);

  if (yes) return;

  if (!(await confirm(out, `Install ${version} over ${VERSION}?`, signal))) throw CANCELED;
}

/** Partial success is a failure: the rows show every provider, and a provider that failed exits 1. */
async function refreshModels(out: Output, host: Connection, signal: AbortSignal): Promise<void> {
  out.progress("Refreshing the model catalog…");

  const refreshFailure = await host.models.refresh().then(() => undefined, errorMessage);

  signal.throwIfAborted();
  const providers = (await host.models.list()).providers;

  const rows: Row[] = providers.map((provider) => ({
    gutter: provider.credential === "failed" ? "fail" : "none",
    label: provider.id,
    value:
      provider.credential === "failed"
        ? "Credential failed"
        : provider.models.length === 0
          ? "No models"
          : `${String(provider.models.length)} ${provider.models.length === 1 ? "model" : "models"}`,
  }));

  const failed = providers.filter((provider) => provider.credential === "failed").length;

  if (refreshFailure === undefined && failed === 0) {
    out.status("done", "Refreshed the model catalog");
    out.rows(rows);

    return;
  }

  out.rows(rows);
  out.say("");

  throw new CliError("failed", "Couldn't refresh the model catalog for every provider.", {
    details: [
      ...(failed === 0
        ? []
        : [
            {
              label: "Failed",
              value: `${String(failed)} ${failed === 1 ? "credential" : "credentials"}`,
            },
          ]),
      ...(refreshFailure === undefined
        ? []
        : [{ label: "Cause", value: printable(refreshFailure) }]),
    ],
  });
}
