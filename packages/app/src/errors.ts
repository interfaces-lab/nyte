import { Type } from "typebox";
import { Value } from "typebox/value";
import type { SdkErrorCode } from "@nyte-ai/sdk";

export type IpcFailure = {
  readonly code: SdkErrorCode;
  readonly message: string;
  readonly correlationId?: string;
};

export type IpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcFailure };

export function bridgeError(error: IpcFailure): Error & { readonly cause: IpcFailure } {
  return { name: "HostError", message: error.message, cause: error };
}

export function errorMessage(cause: unknown): string {
  return Value.Check(Type.Object({ message: Type.String() }), cause)
    ? cause.message
    : String(cause);
}
