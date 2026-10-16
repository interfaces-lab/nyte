import type { HostId, ValidationIssue } from "@nyte-ai/schema";

export type SdkErrorCode =
  | "unauthenticated"
  | "denied"
  | "unknown"
  | "invalid"
  | "stale"
  | "unavailable"
  | "internal";

export class SdkError extends Error {
  override readonly name = "SdkError";
  readonly code: SdkErrorCode;

  readonly hostId: HostId | null;

  readonly issues: readonly ValidationIssue[];

  readonly correlation: string | null;

  constructor(
    code: SdkErrorCode,
    message: string,
    options?: {
      readonly hostId?: HostId | null;
      readonly issues?: readonly ValidationIssue[];
      readonly correlation?: string | null;
    },
  ) {
    super(message);
    this.code = code;
    this.hostId = options?.hostId ?? null;
    this.issues = options?.issues ?? [];
    this.correlation = options?.correlation ?? null;
  }
}
