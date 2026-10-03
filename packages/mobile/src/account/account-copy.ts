/**
 * Account wording, kept as data like `connect-copy.ts`: each ending says what
 * happened, then what to do. `action` names the one control that can help.
 */
import { DEVICE_LIMIT } from "@nyte-ai/connect";
import type { BrokerFailure } from "@nyte-ai/connect";
import type { ConnectEnding } from "./enrollment.ts";
import type { ReleaseReport } from "./revocation.ts";

export interface AccountCopy {
  readonly title: string;
  readonly body: string;
  /** `retry` repeats the same request; `signIn` needs a new Nyte sign-in first. */
  readonly action: "retry" | "signIn" | undefined;
}

const AWAKE = "Make sure your Mac is awake with Nyte open, then try again.";

export function brokerCopy(failure: BrokerFailure): AccountCopy {
  switch (failure.kind) {
    case "signed_out":
      return { title: "Signed out", body: "Sign in again to see your Macs.", action: "signIn" };
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
        title: "Mac not on your account",
        body: "This Mac left your Nyte account. Refresh the list and pick another.",
        action: "retry",
      };
    case "limit":
      return {
        title: "Too many devices",
        body: `This Mac already has ${String(DEVICE_LIMIT)} devices. Remove one in Nyte on your Mac, then try again.`,
        action: "retry",
      };
    case "rate_limited":
      return { title: "Too many tries", body: "Wait a minute, then try again.", action: "retry" };
    case "unreachable":
      return { title: "Your Mac didn't answer", body: AWAKE, action: "retry" };
    case "conflict":
      return {
        title: "Something changed",
        body: "Another change to this Mac happened at the same time. Try again.",
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

/** What to tell the user after a Mac pick that did not connect. Cancelling says nothing. */
export function connectEndingCopy(
  ending: Exclude<ConnectEnding, { kind: "connected" | "cancelled" }>,
): AccountCopy {
  switch (ending.kind) {
    case "broker":
      return brokerCopy(ending.failure);
    case "notAccepted":
      return {
        title: "Your Mac didn't accept this iPhone",
        body: "It didn't take the new connection in time. Make sure Nyte is open on your Mac, then try again.",
        action: "retry",
      };
    case "silent":
      return { title: "Your Mac stopped answering", body: AWAKE, action: "retry" };
    case "notSaved":
      return {
        title: "Connection not saved",
        body: "Your Mac accepted this iPhone, but the Keychain didn't keep it. Unlock your phone and try again.",
        action: "retry",
      };
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
 * What the Mac and the broker confirmed after this phone let go of a Mac.
 * Silence is not removal: the copy claims only what one of them answered.
 */
export function releaseCopy(name: string, report: ReleaseReport): string {
  if (report.host === "removed") return `${name} removed this iPhone.`;

  if (report.broker === "removed") return `${name} stops accepting this iPhone within a minute.`;

  return report.broker === "skipped"
    ? `${name} didn't answer. Remove this iPhone there if it's still listed.`
    : `${name} and Nyte didn't answer. Remove this iPhone on your Mac if it's still listed.`;
}
