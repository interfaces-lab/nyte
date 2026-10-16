import { SdkError } from "@nyte-ai/core";

/**
 * A failure the Connect lifecycle reports to its embedding, as an `SdkError`
 * with a fixed message: a desktop maps it onto IPC, a headless host onto its
 * own output. Only fixed messages belong here; never request or broker text.
 */
export class ConnectError extends SdkError {}

/** The Connect state file cannot be read or written, so remote access stays off. */
export function storeFailed(): ConnectError {
  return new ConnectError("internal", "Nyte can't use ~/.nyte/connect.json. Remote access is off.");
}

/** This build has no broker configuration, or this host has no way to link. */
export function unavailable(): ConnectError {
  return new ConnectError(
    "denied",
    "Account remote access isn't available in this build or on this Mac.",
  );
}

export function notLinked(): ConnectError {
  return new ConnectError("unknown", "Link this Mac to your account first.");
}

export function closed(): ConnectError {
  return new ConnectError("unavailable", "Nyte is quitting.");
}

/** The stored link or link key belongs to another broker than this build's. */
export function originChanged(): ConnectError {
  return new ConnectError(
    "denied",
    "This host is linked through another broker. Unlink it before linking here.",
  );
}
