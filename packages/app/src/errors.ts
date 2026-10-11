import { Type } from "typebox";
import { Value } from "typebox/value";
import type { SdkErrorCode } from "@nyte-ai/sdk";

/** A failure carried across IPC as plain data: its sdk error code, its message, and the call it answers. */
export type IpcFailure = {
  readonly code: SdkErrorCode;
  readonly message: string;
  readonly correlationId?: string;
};

export type IpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcFailure };

/** Plain data: contextBridge drops custom properties from Error instances. */
export function bridgeError(error: IpcFailure): Error & { readonly cause: IpcFailure } {
  return { name: "HostError", message: error.message, cause: error };
}

/** Handles local Errors and plain error data copied across contextBridge. */
export function errorMessage(cause: unknown): string {
  return Value.Check(Type.Object({ message: Type.String() }), cause)
    ? cause.message
    : String(cause);
}
