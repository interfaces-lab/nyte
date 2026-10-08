/**
 * Account wording, kept as data like `connect-copy.ts`: each ending says what
 * happened, then what to do. `action` names the one control that can help.
 */
import { DEVICE_LIMIT } from "@nyte-ai/connect";
import type { BrokerFailure } from "@nyte-ai/connect";
import { connectCopy } from "../connection/connect-copy.ts";
import type { ConnectEnding } from "./enrollment.ts";
import type { ReleaseReport } from "./revocation.ts";

export interface AccountCopy {
  readonly title: string;
  readonly body: string;
  /**
   * `retry` repeats the same request; `signIn` needs a new Nyte sign-in first;
   * `repair` enrolls again and replaces the environment's pinned host identity.
   */
  readonly action: "retry" | "signIn" | "repair" | undefined;
}

const AWAKE = "Make sure the computer is awake and running Nyte, then try again.";

export function brokerCopy(failure: BrokerFailure): AccountCopy {
  switch (failure.kind) {
    case "signed_out":
      return {
        title: "Signed out",
        body: "Sign in again to see your computers.",
        action: "signIn",
      };
    case "network":
      return {
        title: "Couldn't reach Nyte",
        body: "Check that this phone is online, then try again.",
        action: "retry",
      };
    case "bad_response":
      return {
        title: "Unexpected answer",
        body: "Nyte answered in a way this app doesn't understand. Update the app, then try again.",
        action: "retry",
      };
    case "refused":
      break;
    default: {
      const exhaustive: never = failure;

      return exhaustive;
    }
  }

  switch (failure.code) {
    case "unauthorized":
      return {
        title: "Sign in again",
        body: "Your Nyte sign-in is no longer valid.",
        action: "signIn",
      };
    case "session_revoked":
      return {
        title: "Sign in again",
        body: "A device removed from your account was using this sign-in, so it ended too.",
        action: "signIn",
      };
    case "owner_disabled":
      return {
        title: "Account unavailable",
        body: "This Nyte account is locked or disabled. Sign in with another account.",
        action: "signIn",
      };
    case "forbidden":
    case "not_found":
    case "revoked":
      return {
        title: "Not on your account",
        body: "This computer left your Nyte account. Refresh the list and pick another.",
        action: "retry",
      };
    case "limit":
      return {
        title: "Too many devices",
        body: `This computer already has ${String(DEVICE_LIMIT)} devices. Remove one there, then try again.`,
        action: "retry",
      };
    case "rate_limited":
      return { title: "Too many tries", body: "Wait a minute, then try again.", action: "retry" };
    case "unreachable":
      return { title: "The computer didn't answer", body: AWAKE, action: "retry" };
    case "conflict":
      return {
        title: "Something changed",
        body: "Another change to this computer happened at the same time. Try again.",
        action: "retry",
      };
    case "invalid":
      return {
        title: "Request refused",
        body: "Nyte refused this request. Update the app, then try again.",
        action: "retry",
      };
    case "internal":
      return {
        title: "Nyte had a problem",
        body: "Try again in a moment.",
        action: "retry",
      };
    default: {
      const exhaustive: never = failure.code;

      return exhaustive;
    }
  }
}

/** What to tell the user after a pick that did not connect. Cancelling says nothing. */
export function connectEndingCopy(
  ending: Exclude<ConnectEnding, { kind: "connected" | "cancelled" }>,
): AccountCopy {
  switch (ending.kind) {
    case "broker":
      return brokerCopy(ending.failure);
    case "notAccepted":
      return {
        title: "Not accepted",
        body: "The computer didn't take this iPhone in time. Make sure it's running Nyte with remote access on, then try again.",
        action: "retry",
      };
    case "silent":
      return { title: "The computer stopped answering", body: AWAKE, action: "retry" };
    case "notSaved":
      return {
        title: "Connection not saved",
        body: "The computer accepted this iPhone, but the Keychain didn't keep it. Unlock your phone and try again.",
        action: "retry",
      };
    case "unproven": {
      const copy = connectCopy(ending.failure);

      return {
        title: copy.title,
        body: copy.body,
        action: ending.failure.kind === "identityChanged" ? "repair" : "retry",
      };
    }

    case "unexpected":
      return {
        title: "Connecting stopped",
        body: `Connecting stopped for a reason the app doesn't recognize: ${ending.detail}`,
        action: "retry",
      };
    default: {
      const exhaustive: never = ending;

      return exhaustive;
    }
  }
}

/**
 * What the host and the broker confirmed after this phone let go of it.
 * Silence is not removal: the copy claims only what one of them answered.
 */
export function releaseCopy(name: string, report: ReleaseReport): string {
  if (report.host === "removed") return `${name} removed this iPhone.`;

  if (report.broker === "removed") return `${name} stops accepting this iPhone within a minute.`;

  return report.broker === "skipped"
    ? `${name} didn't answer. Remove this iPhone there if it's still listed.`
    : `${name} and Nyte didn't answer. Remove this iPhone there if it's still listed.`;
}
