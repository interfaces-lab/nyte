import { randomUUID } from "node:crypto";
import { SdkError } from "@nyte-ai/sdk";
import type { IpcFailure, IpcResult } from "@nyte-ai/app/errors.ts";
import { ConnectError } from "@nyte-ai/connect/host";

/** Local-only, bounded diagnostics. Never export original exceptions to telemetry or IPC. */
export const ipcDiagnostics = new Map<string, unknown>();

/** Preserve the owner's ID and opaque cause in the shared local retention budget. */
export function retainDiagnostic(diagnostic: {
  readonly correlationId: string;
  readonly cause: unknown;
}): void {
  ipcDiagnostics.set(diagnostic.correlationId, diagnostic.cause);

  if (ipcDiagnostics.size > 32) {
    const oldest = ipcDiagnostics.keys().next();

    if (!oldest.done) ipcDiagnostics.delete(oldest.value);
  }
}

/** Only fixed, main-owned messages belong here. Never pass request or provider text. */
export class ExpectedHostError extends Error {
  readonly error: IpcFailure;

  constructor(error: IpcFailure) {
    super(error.message);
    this.name = "ExpectedHostError";
    this.error = error;
  }
}

export function ipcFailure(cause: unknown): IpcFailure {
  if (cause instanceof ExpectedHostError) return cause.error;

  if (cause instanceof ConnectError) return { code: "unavailable", message: cause.message };

  if (cause instanceof SdkError) return { code: cause.code, message: cause.message };
  const correlationId = randomUUID();
  retainDiagnostic({ correlationId, cause });

  return {
    code: "internal",
    message: `The host operation failed. Diagnostic ID: ${correlationId}`,
    correlationId,
  };
}

/** Owns failures from both request decoding and the operation, preserving returned outcomes. */
export async function ipcResult<T>(operation: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (cause) {
    return { ok: false, error: ipcFailure(cause) };
  }
}
