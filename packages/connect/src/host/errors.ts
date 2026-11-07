import { SdkError } from "@nyte-ai/schema";

export class ConnectError extends SdkError {}

export function storeFailed(): ConnectError {
  return new ConnectError("internal", "Nyte can't use ~/.nyte/connect.json. Remote access is off.");
}

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

export function originChanged(): ConnectError {
  return new ConnectError(
    "denied",
    "This host is linked through another broker. Unlink it before linking here.",
  );
}
