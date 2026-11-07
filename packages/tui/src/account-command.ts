import type {
  ConnectLinkFailure,
  ConnectLinking,
  ConnectUnavailable,
  ConnectView,
} from "@nyte-ai/connect";
import { serviceConnect } from "@nyte-ai/service";
import type { LocalEndpoint } from "@nyte-ai/service";
import { findRunningHost, hostFilePath, hostLogPath } from "@nyte-ai/service/host-endpoint";
import open from "open";
import { CliError } from "./cli/errors.ts";
import type { NextStep, Reason } from "./cli/errors.ts";
import { formatCommand, formatRows, printable } from "./cli/format.ts";
import type { Row } from "./cli/format.ts";
import { parseCommandArgs, readAction } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";
import { confirm } from "./cli/prompt.ts";
import { connectHost } from "./local-host.ts";

type Linked = Extract<ConnectView, { kind: "linked" }>;

type Unlinked = Extract<ConnectView, { kind: "unlinked" }>;

type Awaiting = Extract<ConnectLinking, { kind: "awaiting_approval" }>;

type Request =
  | { readonly action: "link"; readonly open: boolean }
  | { readonly action: "status"; readonly json: boolean }
  | { readonly action: "unlink"; readonly yes: boolean };

const LINK_AGAIN: NextStep = { label: "Start a new request", argv: ["nyte", "account"] };

const UNLINK_RETRY = "Nyte retries it each time a host starts, and while one runs.";

export async function accountCommand(
  args: readonly string[],
  context: { readonly output: Output; readonly signal: AbortSignal },
): Promise<number> {
  const request = parseAccountArgs(args);

  switch (request.action) {
    case "link":
      return link(request.open, context.output, context.signal);
    case "status":
      return status(request.json, context.output);
    case "unlink":
      return unlink(request.yes, context.output, context.signal);
    default: {
      const _exhaustive: never = request;

      return _exhaustive;
    }
  }
}

/** Links this machine and exits once the host shares it; the host keeps sharing after that. */
async function link(openBrowser: boolean, output: Output, signal: AbortSignal): Promise<number> {
  if (!output.mode.interactive)
    throw new CliError("missing_input", "Can't link this machine in non-interactive mode.", {
      details: [
        { label: "Needs", value: "A terminal on stdin and stderr, CI unset and no --json" },
      ],
    });

  const local = await connectHost({ kind: "local" }, (phase) => output.progress(phase));

  try {
    return await share(local.endpoint, openBrowser && output.mode.browser, output, signal);
  } finally {
    await local.close();
  }
}

/**
 * Waits for the first linked view with sharing on. A linked view with sharing off comes first when
 * the host has just linked or still has to turn sharing on. On a signal it returns 0 and the
 * invocation exits 128 + n.
 */
async function share(
  endpoint: LocalEndpoint,
  openBrowser: boolean,
  output: Output,
  signal: AbortSignal,
): Promise<number> {
  let pending: Awaiting | undefined;
  let sharingOff = false;

  for await (const event of serviceConnect(endpoint).share(signal)) {
    if (event.kind === "error")
      throw new CliError(
        "failed",
        sharingOff ? "Couldn't turn on sharing for this machine." : "Couldn't link this machine.",
        { details: [{ label: "Cause", value: printable(event.message) }] },
      );

    if (event.kind === "link_failed") throw linkFailed(event.reason);

    if (event.kind === "relay") continue;
    const view = event.view;

    if (view.kind === "unavailable") throw unavailable(view.reason);

    if (view.kind === "unlinked") {
      const linking = view.linking;

      if (linking.kind !== "awaiting_approval" || linking.userCode === pending?.userCode) continue;
      pending = linking;
      showApproval(linking, openBrowser, output);
      continue;
    }

    if (!view.enabled) {
      sharingOff = true;
      continue;
    }

    showLinked(
      view,
      pending !== undefined ? "linked" : sharingOff ? "shared" : "unchanged",
      output,
    );

    return 0;
  }

  if (!signal.aborted)
    throw new CliError("failed", "Failed to link this machine. The Nyte host stopped.", {
      details: [{ label: "Log", value: hostLogPath() }],
      next: [LINK_AGAIN],
    });

  output.say("");

  if (sharingOff) {
    output.status("none", "Stopped waiting. This machine is linked; sharing wasn't on yet.");
    showNext(output);

    return 0;
  }

  output.status("none", "Stopped waiting. This machine isn't linked.");

  if (pending !== undefined)
    output.status(
      "none",
      `The request stays open until ${expiry(pending.expiresAt)}. Approving it links this machine.`,
    );

  return 0;
}

function showApproval(linking: Awaiting, openBrowser: boolean, output: Output): void {
  if (openBrowser) void open(linking.verifyUrl).catch(() => undefined);
  output.status(
    "none",
    openBrowser
      ? "Approve this machine in the browser, signed in to your Nyte account."
      : "Open the URL on any device and approve this machine, signed in to your Nyte account.",
  );
  output.rows([
    { label: "URL", value: printable(linking.verifyUrl) },
    { label: "Code", value: printable(linking.userCode) },
    { label: "Fingerprint", value: printable(linking.fingerprint) },
    { label: "Expires", value: expiry(linking.expiresAt) },
  ]);
  output.say("");
  output.status("none", "Approve only a request you started, showing this fingerprint.");
  output.status("none", "Waiting for approval…");
}

/** `linked` after an approval in this run, `shared` when this run turned sharing on, `unchanged` otherwise. */
function showLinked(
  view: Linked,
  outcome: "linked" | "shared" | "unchanged",
  output: Output,
): void {
  const name = printable(view.environment.name);

  if (outcome !== "unchanged") output.say("");

  if (outcome === "unchanged")
    output.status("none", "This machine is already linked and shared. Nothing changed.");
  output.rows([
    outcome === "unchanged"
      ? { label: "Name", value: name }
      : { gutter: "done", label: outcome === "linked" ? "Linked" : "Shared", value: name },
    { label: "Account", value: printable(view.owner.label) },
  ]);

  if (!output.mode.tty.stdout) output.result(`${view.environment.id}\n`);
  output.status("none", "Shared while a Nyte host runs, after this command exits.");
  showNext(output);
}

function showNext(output: Output): void {
  output.say("");
  output.say("  See the link and its devices:");
  output.say(formatCommand(["nyte", "account", "status"], output.mode.stderr));
}

async function status(json: boolean, output: Output): Promise<number> {
  const running = await findRunningHost(hostFilePath());

  if (running === null)
    throw new CliError("host_not_running", "Can't read the link. No Nyte host is running.", {
      next: [{ label: "Start a host, then run this again", argv: ["nyte", "host"] }],
    });

  const view = await serviceConnect({ url: running.url, token: running.token }).view();

  if (view.kind === "unavailable") throw unavailable(view.reason);

  if (json) {
    output.json(view);

    return 0;
  }

  output.result(
    `${formatRows(view.kind === "linked" ? linkedRows(view) : unlinkedRows(view), output.mode.stdout).join("\n")}\n`,
  );

  if (
    view.kind === "unlinked" &&
    (view.linking.kind === "idle" || view.linking.kind === "failed")
  ) {
    output.say("");
    output.say("  Link this machine:");
    output.say(formatCommand(["nyte", "account"], output.mode.stderr));
  }

  return 0;
}

function linkedRows(view: Linked): Row[] {
  return [
    { label: "Status", value: "Linked" },
    { label: "Name", value: printable(view.environment.name) },
    { label: "Account", value: printable(view.owner.label) },
    { label: "Address", value: printable(view.environment.address) },
    { label: "Relay", value: relayLine(view) },
    ...view.devices.map((device) => ({
      label: "Device",
      value: `${printable(device.name)}${device.authorized ? "" : " (no access now)"}`,
    })),
  ];
}

function unlinkedRows(view: Unlinked): Row[] {
  const linking = view.linking;

  const notice: Row[] =
    view.notice.kind === "revoked"
      ? [{ label: "Notice", value: "The Nyte account removed this machine" }]
      : view.notice.kind === "unlink_pending"
        ? [{ label: "Unlink", value: `Nyte Connect hasn't confirmed it yet. ${UNLINK_RETRY}` }]
        : [];

  switch (linking.kind) {
    case "idle":
      return [{ label: "Status", value: "Not linked" }, ...notice];
    case "waiting_for_account":
      return [
        { label: "Status", value: "Not linked, waiting for a Nyte account sign-in" },
        ...notice,
      ];
    case "awaiting_approval":
      return [
        { label: "Status", value: "Waiting for approval" },
        { label: "URL", value: printable(linking.verifyUrl) },
        { label: "Code", value: printable(linking.userCode) },
        { label: "Fingerprint", value: printable(linking.fingerprint) },
        { label: "Expires", value: expiry(linking.expiresAt) },
        ...notice,
      ];
    case "linking":
      return [{ label: "Status", value: "Linking…" }, ...notice];
    case "failed":
      return [
        { label: "Status", value: "Not linked" },
        { label: "Last request", value: LINK_FAILURES[linking.reason].cause },
        ...notice,
      ];
    default: {
      const _exhaustive: never = linking;

      return _exhaustive;
    }
  }
}

/** Destructive: preview what goes, then ask, or require `--yes` without a terminal. */
async function unlink(yes: boolean, output: Output, signal: AbortSignal): Promise<number> {
  if (!yes && !output.mode.interactive)
    throw new CliError(
      "missing_input",
      "Can't unlink this machine without --yes in non-interactive mode.",
      {
        next: [
          {
            label: "Only after a human approves, unlink this machine",
            argv: ["nyte", "account", "unlink", "--yes"],
          },
        ],
      },
    );

  const local = await connectHost({ kind: "local" }, (phase) => output.progress(phase));

  try {
    return await unlinkFrom(local.endpoint, yes, output, signal);
  } finally {
    await local.close();
  }
}

async function unlinkFrom(
  endpoint: LocalEndpoint,
  yes: boolean,
  output: Output,
  signal: AbortSignal,
): Promise<number> {
  const connect = serviceConnect(endpoint);
  const before = await connect.view();

  if (before.kind === "unavailable") throw unavailable(before.reason);

  if (before.kind === "unlinked") {
    output.status(
      "none",
      before.notice.kind === "unlink_pending"
        ? `This machine isn't linked. Nyte Connect hasn't confirmed the last unlink yet. ${UNLINK_RETRY}`
        : "This machine isn't linked to a Nyte account. Nothing changed.",
    );

    return 0;
  }

  const account = printable(before.owner.label);

  if (!yes) {
    showUnlinkPreview(before, output);

    if (!(await confirm(output, `Unlink this machine from ${account}?`, signal))) {
      output.status("none", "Canceled.");

      return 130;
    }
  }

  const after = await connect.unlink().catch((cause: unknown) => {
    throw new CliError(
      "failed",
      "Couldn't confirm the unlink. The Nyte host refused or stopped partway.",
      {
        details: [
          {
            label: "Cause",
            value: printable(cause instanceof Error ? cause.message : String(cause)),
          },
        ],
        next: [
          {
            label: "Check whether this machine is still linked",
            argv: ["nyte", "account", "status"],
          },
        ],
      },
    );
  });

  output.rows([
    { gutter: "done", label: "Unlinked", value: printable(before.environment.name) },
    { label: "Account", value: account },
  ]);

  if (!output.mode.tty.stdout || !output.mode.interactive)
    output.result(`${before.environment.id}\n`);

  if (after.kind === "unlinked" && after.notice.kind === "unlink_pending")
    output.status("warn", `Nyte Connect hasn't confirmed the unlink yet. ${UNLINK_RETRY}`);

  return 0;
}

function showUnlinkPreview(view: Linked, output: Output): void {
  const names = view.devices.map((device) => printable(device.name));
  const count = `${String(names.length)} ${names.length === 1 ? "device loses" : "devices lose"} access`;

  output.rows([
    { label: "Name", value: printable(view.environment.name) },
    { label: "Account", value: printable(view.owner.label) },
    { label: "Address", value: `${printable(view.environment.address)} stops working` },
    {
      label: "Devices",
      value:
        names.length === 0
          ? "None have access"
          : `${count}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${String(names.length - 5)} more` : ""}`,
    },
  ]);
  output.say("");
  output.status("none", "Linking again needs a new approval in the browser.");
}

function relayLine(view: Linked): string {
  const devices = `${String(view.devices.length)} ${view.devices.length === 1 ? "device" : "devices"}`;

  switch (view.connection.kind) {
    case "stopped":
      return "Off";
    case "connecting":
      return "Connecting…";
    case "retrying":
      return `Reconnecting, attempt ${String(view.connection.attempt)}…`;
    case "failed":
      return "Taken over by another Nyte app on this machine";
    case "connected":
      break;
    default: {
      const _exhaustive: never = view.connection;

      return _exhaustive;
    }
  }

  switch (view.lease.kind) {
    case "current":
      return `Connected, ${devices}`;
    case "pending":
    case "stopped":
      return "Connected, waiting for access…";
    case "lapsed":
      return view.lease.reason === "owner_disabled"
        ? "Refused, the Nyte account is locked or disabled"
        : "Connected, access lapsed, renewing…";
    default: {
      const _exhaustive: never = view.lease;

      return _exhaustive;
    }
  }
}

function expiry(at: number): string {
  return new Date(at).toLocaleTimeString();
}

const LINK_FAILURES: Readonly<
  Record<
    ConnectLinkFailure,
    { readonly reason: Reason; readonly cause: string; readonly next?: NextStep }
  >
> = {
  cancelled: { reason: "failed", cause: "The request was canceled", next: LINK_AGAIN },
  network: {
    reason: "network_error",
    cause: "Nyte Connect couldn't be reached",
    next: { label: "Check your connection, then start a new request", argv: ["nyte", "account"] },
  },
  limit: {
    reason: "failed",
    cause: "The account can't link another machine right now",
    next: {
      label: "Unlink a machine you no longer use, then link this one",
      argv: ["nyte", "account"],
    },
  },
  owner_disabled: { reason: "failed", cause: "The Nyte account is locked or disabled" },
  session_revoked: {
    reason: "failed",
    cause: "The approving sign-in was revoked",
    next: {
      label: "Sign in again in the browser, then start a new request",
      argv: ["nyte", "account"],
    },
  },
  denied: { reason: "failed", cause: "The request was declined in the browser", next: LINK_AGAIN },
  expired: { reason: "failed", cause: "The request expired before approval", next: LINK_AGAIN },
  refused: { reason: "failed", cause: "Nyte Connect refused it" },
};

function linkFailed(failure: ConnectLinkFailure): CliError {
  const entry = LINK_FAILURES[failure];

  return new CliError(entry.reason, `Couldn't link this machine. ${entry.cause}.`, {
    next: entry.next === undefined ? [] : [entry.next],
  });
}

function unavailable(reason: ConnectUnavailable): CliError {
  switch (reason) {
    case "not_configured":
      return new CliError(
        "failed",
        "Can't use Nyte Connect. NYTE_CONNECT_ORIGIN isn't a valid origin.",
        {
          details: [
            { label: "Expected", value: "An https:// origin with no path, or unset" },
            { label: "Read by", value: "The Nyte host, when it starts" },
          ],
        },
      );
    case "store_failed":
      return new CliError("failed", "Can't read this machine's Nyte Connect file.", {
        details: [
          { label: "File", value: "~/.nyte/connect.json" },
          { label: "Fix", value: "Remove it to start over; this machine then needs linking again" },
        ],
      });
    case "origin_changed":
      return new CliError(
        "conflict",
        "Can't use the link. It was made through another Nyte Connect origin.",
        {
          next: [
            {
              label: "With NYTE_CONNECT_ORIGIN set to that origin, unlink it",
              argv: ["nyte", "account", "unlink"],
            },
          ],
        },
      );
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

/** One action word, then only that action's options; every mistake fails before any host work. */
function parseAccountArgs(args: readonly string[]): Request {
  const found = readAction("account", args);
  const action = found.action;

  switch (action) {
    case "link":
      return { action, open: !parseCommandArgs("account", found.args, 0, action).has("no-open") };
    case "status":
      return { action, json: parseCommandArgs("account", found.args, 0, action).has("json") };
    case "unlink":
      return { action, yes: parseCommandArgs("account", found.args, 0, action).has("yes") };
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}
