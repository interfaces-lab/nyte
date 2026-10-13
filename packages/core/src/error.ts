import type { HostId, ValidationIssue } from "@nyte-ai/schema";

/**
 * Names the kind of failure an {@link SdkError} carries.
 *
 * @category errors
 * @since 0.1.0
 */
export type SdkErrorCode =
  | "unauthenticated"
  | "denied"
  | "unknown"
  | "invalid"
  | "stale"
  | "unavailable"
  | "internal";

/**
 * Throws for acquisition failures and defects; domain results are outcomes,
 * never this.
 *
 * **Details**
 *
 * One error: core throws it, protocol serialises it, and the sdk rethrows the
 * same class.
 *
 * @category errors
 * @since 0.1.0
 */
export class SdkError extends Error {
  override readonly name = "SdkError";
  readonly code: SdkErrorCode;
  /** The host that answered, when known. */
  readonly hostId: HostId | null;
  /** Set for `invalid`. */
  readonly issues: readonly ValidationIssue[];
  /** For `internal`; matches the host's logs. */
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
