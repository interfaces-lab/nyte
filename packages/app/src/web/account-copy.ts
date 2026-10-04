import { BrokerError, DEVICE_LIMIT } from "@nyte-ai/connect";

export class AcceptanceError extends Error {
  constructor(kind: "notAccepted" | "silent") {
    super(
      kind === "notAccepted"
        ? "Your desktop didn't accept this browser. Make sure Nyte is open, then try again."
        : "Your desktop didn't answer. Make sure it's awake with Nyte open, then try again.",
    );
  }
}

export function accountProblem(cause: unknown): string {
  if (cause instanceof AcceptanceError) return cause.message;

  if (!(cause instanceof BrokerError))
    return "Couldn't connect. Check your connection and try again.";
  const failure = cause.failure;

  switch (failure.kind) {
    case "signed_out":
      return "Sign in again to see your desktops.";
    case "network":
      return "Couldn't reach Nyte. Check your connection and try again.";
    case "bad_response":
      return "Unexpected answer from Nyte. Try again.";
    case "refused":
      break;
    default: {
      const exhaustive: never = failure;

      return exhaustive;
    }
  }

  switch (failure.code) {
    case "unauthorized":
    case "session_revoked":
      return "Your Nyte sign-in has ended. Sign out, then sign in again.";
    case "owner_disabled":
      return "This Nyte account is locked or disabled. Sign in with another account.";
    case "forbidden":
    case "not_found":
    case "revoked":
      return "This desktop left your Nyte account. Refresh the list and pick another.";
    case "limit":
      return `This desktop already has ${String(DEVICE_LIMIT)} devices. Remove one in Nyte on your desktop, then try again.`;
    case "rate_limited":
      return "Too many tries. Wait a minute, then try again.";
    case "unreachable":
      return "Your desktop didn't answer. Make sure it's awake with Nyte open, then try again.";
    case "conflict":
      return "Another change to this desktop happened at the same time. Try again.";
    case "invalid":
      return "Nyte refused this request. Try again.";
    case "internal":
      return "Nyte had a problem. Try again in a moment.";
    default: {
      const exhaustive: never = failure.code;

      return exhaustive;
    }
  }
}
