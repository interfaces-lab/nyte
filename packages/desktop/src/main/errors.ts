import { randomUUID } from "node:crypto";
import type { IpcFailure, IpcResult } from "@nyte-ai/app/errors.ts";

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

/**
 * A failure already safe to show the renderer: a fixed message main or the host process wrote,
 * or an SDK failure the host process classified. Never pass request or provider text.
 */
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
