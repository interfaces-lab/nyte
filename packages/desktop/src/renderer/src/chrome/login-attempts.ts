/**
 * Running provider sign-ins, keyed by provider. The renderer chooses each
 * attempt's ID before calling the host, so progress that arrives for an older
 * or cancelled attempt has no entry to land in and is dropped.
 */
import { useSyncExternalStore } from "react";
import type { HostEvent, LoginProgress } from "../../../shared/ipc.ts";

export interface DeviceCode {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresInSeconds: number | undefined;
  /** The provider's own words about the code, kept beside it for the attempt's life. */
  readonly instructions: string | undefined;
}

export interface LoginAttemptView {
  readonly attempt: string;
  readonly method: "browser" | "api_key";
  /** Stays for the attempt's whole life; a later message never replaces it. */
  readonly deviceCode: DeviceCode | undefined;
  /** The flow's latest word, if it said anything. */
  readonly message: string | undefined;
  readonly cancelling: boolean;
}

let attempts: ReadonlyMap<string, LoginAttemptView> = new Map();
const listeners = new Set<() => void>();

function set(provider: string, view: LoginAttemptView | undefined): void {
  const next = new Map(attempts);
  if (view === undefined) next.delete(provider);
  else next.set(provider, Object.freeze(view));
  attempts = next;
  for (const listener of listeners) listener();
}

export function newLoginAttemptId(): string {
  return crypto.randomUUID();
}

export function beginLoginAttempt(input: {
  provider: string;
  attempt: string;
  method: "browser" | "api_key";
}): void {
  set(input.provider, {
    attempt: input.attempt,
    method: input.method,
    deviceCode: undefined,
    message: undefined,
    cancelling: false,
  });
}

export function setLoginAttemptCancelling(
  provider: string,
  attempt: string,
  cancelling: boolean,
): void {
  const current = attempts.get(provider);
  if (current?.attempt === attempt && current.cancelling !== cancelling)
    set(provider, { ...current, cancelling });
}

/** Forget the attempt once its call settles; a different attempt for the provider stays. */
export function endLoginAttempt(provider: string, attempt: string): void {
  if (attempts.get(provider)?.attempt === attempt) set(provider, undefined);
}

function apply(current: LoginAttemptView, progress: LoginProgress): LoginAttemptView {
  switch (progress.kind) {
    case "device_code":
      return {
        ...current,
        deviceCode: {
          userCode: progress.userCode,
          verificationUri: progress.verificationUri,
          expiresInSeconds: progress.expiresInSeconds,
          instructions: progress.instructions,
        },
        message: undefined,
      };
    case "message":
      return { ...current, message: progress.message };
    default: {
      const _exhaustive: never = progress;
      return _exhaustive;
    }
  }
}

export function applyLoginEvent(event: Extract<HostEvent, { kind: "login_progress" }>): void {
  const current = attempts.get(event.provider);
  if (current === undefined || current.attempt !== event.attempt) return;
  set(event.provider, apply(current, event.progress));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLoginAttempt(provider: string): LoginAttemptView | undefined {
  const read = (): LoginAttemptView | undefined => attempts.get(provider);
  return useSyncExternalStore(subscribe, read, read);
}
