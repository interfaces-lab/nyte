import {
  InvalidRipgrepPattern,
  WorkspaceFileError,
  WorkspaceSearchError,
  WorkspaceTrustRequired,
} from "@nyte-ai/host";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { randomUUID } from "node:crypto";
import { NyteClosed, UnknownSession } from "@nyte-ai/core";
import { CursorExpired } from "@nyte-ai/protocol";
import type { NyteOptions } from "@nyte-ai/core";
import type { IpcFailure, IpcResult } from "../shared/errors.ts";
import type { WireError } from "@nyte-ai/protocol";

const errnoException = Type.Object({ code: Type.String() });

/** Node's errno code on a thrown value, when it carries one. */
export function errorCode(cause: unknown): string | undefined {
  return Value.Check(errnoException, cause) ? cause.code : undefined;
}

/** Local-only, bounded diagnostics. Never export original exceptions to telemetry or IPC. */
export const ipcDiagnostics = new Map<string, unknown>();

/** Preserve the owner's ID and opaque cause in the shared local retention budget. */
export function retainDiagnostic(
  diagnostic: Pick<
    Parameters<NonNullable<NyteOptions["onDiagnostic"]>>[0],
    "correlationId" | "cause"
  >,
): void {
  ipcDiagnostics.set(diagnostic.correlationId, diagnostic.cause);
  if (ipcDiagnostics.size > 32) {
    const oldest = ipcDiagnostics.keys().next();
    if (!oldest.done) ipcDiagnostics.delete(oldest.value);
  }
}

/** Only fixed, main-owned messages belong here. Never pass request or provider text. */
export class ExpectedHostError extends Error {
  readonly error: WireError;

  constructor(error: WireError) {
    super(error.message);
    this.name = "ExpectedHostError";
    this.error = error;
  }
}

export function ipcFailure(cause: unknown): IpcFailure {
  if (cause instanceof ExpectedHostError) return cause.error;
  if (cause instanceof InvalidRipgrepPattern)
    return { code: "invalid_input", message: cause.message, issues: [] };
  // Workspace search rewraps a rejected pattern, so the bare ripgrep error above
  // only reaches here from the direct search path.
  if (cause instanceof WorkspaceSearchError)
    return { code: "invalid_input", message: cause.message, issues: [] };
  if (cause instanceof WorkspaceFileError) {
    switch (cause.reason) {
      case "outside_workspace":
        return { code: "forbidden", message: cause.message };
      case "not_file":
      // The path no longer names the file that was opened, so the request cannot
      // be served as asked. It never reaches a remote client: workspace files are
      // desktop's own IPC calls, not protocol operations.
      case "changed":
        return { code: "invalid_input", message: cause.message, issues: [] };
      case "too_large":
      case "drafts_too_large":
        return { code: "payload_too_large", message: cause.message };
      default: {
        const exhaustive: never = cause.reason;
        return exhaustive;
      }
    }
  }
  if (cause instanceof CursorExpired)
    return {
      code: "cursor_expired",
      message: "History changed. Refresh the conversation and resume from its snapshot.",
      floor: cause.floor,
    };
  if (cause instanceof UnknownSession)
    return {
      code: "unknown_session",
      message: "This conversation no longer exists. Select another conversation.",
    };
  if (cause instanceof NyteClosed)
    return { code: "closed", message: "The session host is closed. Reopen the window." };
  if (cause instanceof WorkspaceTrustRequired)
    return {
      code: "forbidden",
      message: "Workspace trust is required. Review the workspace trust prompt.",
    };
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
