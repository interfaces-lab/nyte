import type { WireError } from "@nyte-ai/protocol";

export type IpcFailure = WireError & { readonly correlationId?: string };

export type IpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcFailure };

/** Plain data: contextBridge drops custom properties from Error instances. */
export function bridgeError(error: IpcFailure): Error & { readonly cause: IpcFailure } {
  return { name: "HostError", message: error.message, cause: error };
}

/** Handles local Errors and plain error data copied across contextBridge. */
export function errorMessage(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  )
    return cause.message;
  return String(cause);
}
