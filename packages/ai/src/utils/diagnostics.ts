/**
 * Redacted diagnostics attached to an AssistantMessage for failures and recoveries (retries, transport errors).
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/diagnostics.ts
 * Synced with pi 7ebf9087e.
 */
import type { AssistantMessageDiagnostic, DiagnosticErrorInfo } from "@nyte-ai/schema";

// Nyte divergence: the diagnostic shapes live in @nyte-ai/schema because AssistantMessage (wire type) carries them; re-exported here so callers that follow pi's layout keep working.
export type { AssistantMessageDiagnostic, DiagnosticErrorInfo };

export function formatThrownValue(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name;

  return String(cause);
}

export function extractDiagnosticError(cause: unknown): DiagnosticErrorInfo {
  if (!(cause instanceof Error)) return { name: "ThrownValue", message: formatThrownValue(cause) };
  const code = "code" in cause ? cause.code : undefined;

  return {
    name: cause.name || undefined,
    message: cause.message || cause.name,
    stack: cause.stack,
    code: typeof code === "string" || typeof code === "number" ? code : undefined,
  };
}

export function createAssistantMessageDiagnostic(
  type: string,
  cause: unknown,
  details?: AssistantMessageDiagnostic["details"],
): AssistantMessageDiagnostic {
  return { type, timestamp: Date.now(), error: extractDiagnosticError(cause), details };
}

export function appendAssistantMessageDiagnostic<
  T extends { diagnostics?: AssistantMessageDiagnostic[] },
>(message: T, diagnostic: AssistantMessageDiagnostic): void {
  message.diagnostics = [...(message.diagnostics ?? []), diagnostic];
}
