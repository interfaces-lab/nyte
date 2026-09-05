/**
 * Result, ported from pi-agent-core.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/result.ts
 */

export interface Ok<TValue> {
  ok: true;
  value: TValue;
}

export interface Err<TError> {
  ok: false;
  error: TError;
}

export type Result<TValue, TError> = Ok<TValue> | Err<TError>;

export const Result = {
  ok<TValue>(value: TValue): Ok<TValue> {
    return { ok: true, value };
  },
  err<TError>(error: TError): Err<TError> {
    return { ok: false, error };
  },
};
