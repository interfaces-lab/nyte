import { randomUUID } from "node:crypto";
import type { IpcFailure, IpcResult } from "@nyte-ai/app/errors.ts";

export const ipcDiagnostics = new Map<string, unknown>();

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

export class ExpectedHostError extends Error {
  readonly error: IpcFailure;

  constructor(error: IpcFailure) {
    super(error.message);
    this.name = "ExpectedHostError";
    this.error = error;
  }
}

function ipcFailure(cause: unknown): IpcFailure {
  if (cause instanceof ExpectedHostError) return cause.error;
  const correlationId = randomUUID();
  retainDiagnostic({ correlationId, cause });

  return {
    code: "internal",
    message: `The host operation failed. Diagnostic ID: ${correlationId}`,
    correlationId,
  };
}

export async function ipcResult<T>(operation: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (cause) {
    return { ok: false, error: ipcFailure(cause) };
  }
}
