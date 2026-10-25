import process from "node:process";
import type {
  ConnectLinkFailure,
  ConnectLinking,
  ConnectUnavailable,
  ConnectView,
} from "@nyte-ai/connect";
import { serviceConnect } from "@nyte-ai/service";
import open from "open";
import { alignedRows, ansiEnabled } from "./cli-style.ts";
import { connectLocalHost } from "./local-host.ts";
import type { HostSession } from "./local-host.ts";

interface Output {
  readonly write: (text: string) => void;
  readonly error: (text: string) => void;
}

type Linked = Extract<ConnectView, { kind: "linked" }>;

export async function accountCommand(
  args: readonly string[],
  signal: AbortSignal,
  output: Output,
): Promise<void> {
  const [command, ...rest] = args;

  if (rest.length > 0 || (command !== undefined && command !== "status" && command !== "unlink"))
    throw new Error("Usage: nyte account [status | unlink]. Run `nyte account --help`.");

  switch (command) {
    case undefined:
      return share(signal, output);
    case "status":
      return status(output);
    case "unlink":
      return unlink(output);
    default: {
      const _exhaustive: never = command;

      return _exhaustive;
    }
  }
}

async function withLocal<T>(act: (local: HostSession) => Promise<T>): Promise<T> {
  const local = await connectLocalHost();

  try {
    return await act(local);
  } finally {
    await local.close();
  }
}

function share(signal: AbortSignal, output: Output): Promise<void> {
  return withLocal((local) => shareFrom(local, signal, output));
}

async function shareFrom(local: HostSession, signal: AbortSignal, output: Output): Promise<void> {
  const connect = serviceConnect(local.endpoint);
  const browser = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let shownCode = "";
  let introduced = false;
  let lastRelay = "";

  for await (const event of connect.share(signal)) {
    if (event.kind === "error") throw new Error(event.message);

    if (event.kind === "link_failed") throw new Error(linkFailureMessage(event.reason));

    if (event.kind === "relay") continue;
    const { view } = event;

    if (view.kind === "unavailable") throw new Error(unavailableMessage(view.reason));

    if (view.kind === "unlinked") {
      const { linking } = view;

      if (linking.kind !== "awaiting_approval" || linking.userCode === shownCode) continue;
      shownCode = linking.userCode;
      output.write(approval(linking, browser));

      if (browser) void open(linking.verifyUrl).catch(() => undefined);
      continue;
    }

    if (!introduced) {
      introduced = true;
      output.write(
        [
          "Sharing this machine with your Nyte account. Ctrl-C stops.",
          ...rows([
            { label: "Name", detail: view.environment.name },
            { label: "Account", detail: view.owner.label },
          ]),
          "",
        ].join("\n"),
      );
    }

    const relay = relayLine(view);

    if (relay !== lastRelay) {
      lastRelay = relay;
      output.write(`${rows([{ label: "Relay", detail: relay }]).join("\n")}\n`);
    }
  }

  if (!signal.aborted) throw new Error("This nyte's host stopped. Run `nyte account` again.");
  output.write(introduced ? "Stopped sharing.\n" : "Cancelled. Nothing was linked.\n");
}

async function status(output: Output): Promise<void> {
  const view = await withLocal((local) => serviceConnect(local.endpoint).view());

  if (view.kind === "unavailable") throw new Error(unavailableMessage(view.reason));

  if (view.kind === "unlinked") {
    output.write(
      view.notice.kind === "unlink_pending"
        ? "Not linked. Nyte Connect hasn't confirmed the last unlink yet; it's retried.\n"
        : "This machine isn't linked to a Nyte account. Run `nyte account` to link it.\n",
    );

    return;
  }

  output.write(
    `${rows([
      { label: "Name", detail: view.environment.name },
      { label: "Account", detail: view.owner.label },
      { label: "Address", detail: view.environment.address },
      { label: "Relay", detail: relayLine(view) },
      ...view.devices.map((device) => ({
        label: "Device",
        detail: `${device.name}${device.authorized ? "" : " (no access now)"}`,
      })),
    ]).join("\n")}\n`,
  );
}

function unlink(output: Output): Promise<void> {
  return withLocal((local) => unlinkFrom(local, output));
}

async function unlinkFrom(local: HostSession, output: Output): Promise<void> {
  const connect = serviceConnect(local.endpoint);
  const before = await connect.view();

  if (before.kind === "unavailable") throw new Error(unavailableMessage(before.reason));

  if (before.kind === "unlinked") {
    output.write("This machine isn't linked to a Nyte account.\n");

    return;
  }

  const after = await connect.unlink();

  output.write(
    after.kind === "unlinked" && after.notice.kind === "unlink_pending"
      ? "Unlinked here. Nyte Connect hasn't confirmed yet; the next nyte retries.\n"
      : `Unlinked from ${before.owner.label}.\n`,
  );
}

function rows(entries: readonly { readonly label: string; readonly detail: string }[]): string[] {
  return alignedRows(entries, ansiEnabled(), 7);
}

function approval(
  linking: Extract<ConnectLinking, { kind: "awaiting_approval" }>,
  browser: boolean,
): string {
  return [
    browser
      ? "Approve this machine in your browser, signed in to your Nyte account:"
      : "Approve this machine from a browser on any device, signed in to your Nyte account:",
    ...rows([
      { label: "Open", detail: linking.verifyUrl },
      { label: "Code", detail: linking.userCode },
      { label: "Compare", detail: `fingerprint ${linking.fingerprint}` },
    ]),
    `Approve only a request you started. It expires at ${new Date(linking.expiresAt).toLocaleTimeString()}; Ctrl-C cancels.`,
    "",
  ].join("\n");
}

function relayLine(view: Linked): string {
  const devices = `${String(view.devices.length)} ${view.devices.length === 1 ? "device" : "devices"}`;

  switch (view.connection.kind) {
    case "stopped":
      return "off";
    case "connecting":
      return "connecting…";
    case "retrying":
      return `reconnecting (attempt ${String(view.connection.attempt)})…`;
    case "failed":
      return "taken over by another Nyte app on this machine";
    case "connected":
      break;
    default: {
      const _exhaustive: never = view.connection;

      return _exhaustive;
    }
  }

  switch (view.lease.kind) {
    case "current":
      return `connected · ${devices}`;
    case "pending":
    case "stopped":
      return "connected, waiting for access…";
    case "lapsed":
      return view.lease.reason === "owner_disabled"
        ? "refused: the Nyte account is locked or disabled"
        : "connected, access lapsed; renewing…";
    default: {
      const _exhaustive: never = view.lease;

      return _exhaustive;
    }
  }
}

function unavailableMessage(reason: ConnectUnavailable): string {
  switch (reason) {
    case "not_configured":
      return "NYTE_CONNECT_ORIGIN isn't a valid Nyte Connect origin. Use an https:// origin with no path or unset it, then run nyte again.";
    case "store_failed":
      return "Can't read ~/.nyte/connect.json. Remove it to start over.";
    case "origin_changed":
      return "This machine is linked through another Nyte Connect origin. Set NYTE_CONNECT_ORIGIN to it, then run `nyte account unlink`.";
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

function linkFailureMessage(reason: ConnectLinkFailure): string {
  switch (reason) {
    case "cancelled":
      return "Linking was cancelled. Nothing was linked.";
    case "network":
      return "Couldn't reach Nyte Connect. Check your connection, then run `nyte account` again.";
    case "limit":
      return "This account can't link another machine right now. Unlink one you no longer use, then try again.";
    case "owner_disabled":
      return "This Nyte account is locked or disabled, so it can't link machines.";
    case "session_revoked":
      return "The approving sign-in was revoked. Sign in again in the browser, then run `nyte account` again.";
    case "denied":
      return "The request was declined in the browser. Nothing was linked.";
    case "expired":
      return "The request expired before it was approved. Run `nyte account` again.";
    case "refused":
      return "Nyte Connect refused to link this machine.";
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}
