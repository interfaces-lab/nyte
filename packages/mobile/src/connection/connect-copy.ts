/**
 * Connect-screen copy, kept as data so each outcome is a case rather than a
 * string assembled at a call site. Every stage answers two questions in order:
 * what happened, then what to do next. A stage without a next step is a dead
 * end the user has to guess their way out of.
 *
 * Wording follows the host's own labels. When the desktop renames a setting,
 * this file is the one place the instructions change.
 */

import { NyteTransportError, NyteWireError } from "@nyte-ai/client";
import type { SavedConnection } from "./connection.ts";

/**
 * How one attempt ended badly. `host.ts` is the only producer, because that is
 * where the client's errors exist. Naming each ending as a value is what keeps
 * a refused token apart from a host that never answered.
 */
export type ConnectFailure =
  /** Reached a Nyte server; it refused the token. */
  | { readonly kind: "refused" }
  /** Nothing answered within the verify window. */
  | { readonly kind: "silent"; readonly address: string }
  /** Something answered and was not a Nyte server. */
  | { readonly kind: "wrongServer"; readonly address: string }
  /** The host answered; the Keychain would not hold the token. */
  | { readonly kind: "notSaved" }
  /**
   * This route pinned a host identity and the answer did not prove it: another
   * key, or none. Only an explicit re-pair of the same `url` replaces the pin.
   */
  | { readonly kind: "identityChanged"; readonly address: string; readonly url: string }
  /** It named an identity it could not sign for, or is a registry host naming none. */
  | { readonly kind: "unverified"; readonly address: string }
  /** The Keychain would not read or keep this route's host pin. */
  | { readonly kind: "keychain" }
  /** Nothing here recognized the ending. Say so rather than blame the network. */
  | { readonly kind: "unexpected"; readonly detail: string }
  | { readonly kind: "cancelled" };

/** Where the user is in one attempt. Failures name the cause, not just "failed". */
export type ConnectStage =
  | { readonly kind: "idle" }
  | { readonly kind: "verifying"; readonly address: string }
  /** The details never left the phone: the address breaks the HTTP/HTTPS policy. */
  | { readonly kind: "rejected"; readonly reason: string }
  | ConnectFailure;

export interface ConnectCopy {
  /** What happened, in a few words. */
  readonly title: string;
  /** The next thing to do, as an instruction. */
  readonly body: string;
  /** Present when retrying the same details could work. */
  readonly retry: string | undefined;
}

/** Where a Mac shares itself, by address and token or through a Nyte account. Spelled as the desktop labels it. */
export const SHARE_LOCATION = "Environments › Remote Access";

export function connectCopy(stage: ConnectStage): ConnectCopy {
  switch (stage.kind) {
    case "idle":
      return {
        title: "Connect a computer",
        body: `On your Mac, open ${SHARE_LOCATION} and start sharing, or run nyte serve on another computer. Enter the address and token it shows.`,
        retry: undefined,
      };
    case "verifying":
      return {
        title: "Checking the host",
        body: `Waiting for ${stage.address} to answer.`,
        retry: undefined,
      };
    case "rejected":
      return { title: "Check the details", body: stage.reason, retry: undefined };
    case "refused":
      return {
        title: "Token refused",
        body: `The host didn't accept this token. Scan a new code from ${SHARE_LOCATION} on your Mac, or use the current token from nyte serve.`,
        retry: "Try again",
      };
    case "silent":
      return {
        title: "No answer",
        body: `Nothing replied at ${stage.address}. Check that the computer is awake and sharing, and that this phone is online. A Tailscale address also needs Tailscale running on this phone.`,
        retry: "Try again",
      };
    case "wrongServer":
      return {
        title: "Not a Nyte server",
        body: `${stage.address} answered, but not as Nyte. Check you copied the whole address, including its port.`,
        retry: undefined,
      };
    case "notSaved":
      return {
        title: "Token not saved",
        body: "The host answered, but the token didn't reach the Keychain. Unlock your phone and try again.",
        retry: "Try again",
      };
    case "identityChanged":
      return {
        title: "Different host",
        body: `${stage.address} isn't the computer this iPhone paired with. If Nyte was reinstalled or its profile reset there, pair it as a new host.`,
        retry: "Pair as New Host",
      };
    case "unverified":
      return {
        title: "Host not verified",
        body: `${stage.address} didn't prove which computer it is. Update Nyte there, then try again.`,
        retry: "Try again",
      };
    case "keychain":
      return {
        title: "Keychain unavailable",
        body: "Unlock your phone and try again.",
        retry: "Try again",
      };
    case "unexpected":
      return {
        title: "Connecting stopped",
        body: `Connecting stopped for a reason the app doesn't recognize: ${stage.detail}`,
        retry: "Try again",
      };
    case "cancelled":
      return {
        title: "Stopped",
        body: "You stopped checking. The details are still here.",
        retry: "Try again",
      };
    default: {
      const exhaustive: never = stage;

      return exhaustive;
    }
  }
}

/**
 * The lead paragraph before an attempt. Editing an existing connection needs a
 * different instruction: the details are already filled in, and the user is
 * here to replace them. With a Nyte account, the account comes first, and an
 * account connection is replaced by picking its computer again.
 */
export function introCopy(input: {
  editing: "manual" | "managed" | undefined;
  account: boolean;
}): ConnectCopy {
  if (input.editing === "managed" && input.account)
    return {
      title: "Update your computer",
      body: "Pick it from your Nyte account again.",
      retry: undefined,
    };

  if (input.editing !== undefined)
    return {
      title: "Update your computer",
      body: `Enter the address and token it uses now, or scan a new code from ${SHARE_LOCATION}.`,
      retry: undefined,
    };

  return input.account
    ? {
        title: "Connect a computer",
        body: "Sign in with the Nyte account your computer is linked to.",
        retry: undefined,
      }
    : connectCopy({ kind: "idle" });
}

/**
 * The saved host did not verify on the way back in. An account device the
 * host refuses is picked again from the account, not fixed with a new token.
 */
export function recoveryCopy(
  failure: Exclude<ConnectFailure, { kind: "cancelled" }>,
  saved: SavedConnection,
): ConnectCopy {
  if (failure.kind === "refused" && saved.kind === "managed")
    return {
      title: "Not accepted",
      body: `${saved.connection.name} no longer accepts this iPhone. Pick it from your Nyte account again.`,
      retry: "Try again",
    };

  return connectCopy(failure);
}

/**
 * Name what a failed verification means for the user. A server that answers and
 * refuses is a different problem from one that never answers, and the two need
 * different instructions; collapsing them into "couldn't connect" hides which.
 *
 * The parameter is the client's two error types, never `unknown`. An unnamed
 * cause has to be handled where it was caught instead of guessed at here, which
 * is what once turned every failure into "No answer".
 */
export function classifyConnectFailure(
  cause: NyteWireError | NyteTransportError,
  address: string,
): ConnectFailure {
  if (cause instanceof NyteWireError) {
    if (cause.code === "unauthorized" || cause.code === "forbidden") return { kind: "refused" };

    return { kind: "wrongServer", address };
  }

  switch (cause.failure.kind) {
    case "network":
    case "disconnected":
      return { kind: "silent", address };
    case "bad_status":
    case "bad_content_type":
    case "bad_body":
      return { kind: "wrongServer", address };
    default: {
      const exhaustive: never = cause.failure;

      return exhaustive;
    }
  }
}
