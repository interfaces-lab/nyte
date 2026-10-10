import { Type } from "typebox";
import type { ValidationIssue } from "../errors.ts";
import type { HostId } from "../ids.ts";
import type { Failure } from "../model/message.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { idSchema } from "./ids.ts";
import { nullable } from "./nullable.ts";

/** Returns the wire form of an `SdkError`: what protocol serialises and the sdk rethrows. */
export type SdkErrorWire = {
  readonly code:
    | "unauthenticated"
    | "denied"
    | "unknown"
    | "invalid"
    | "stale"
    | "unavailable"
    | "internal";
  readonly message: string;
  readonly hostId: HostId | null;
  readonly issues: readonly ValidationIssue[];
  readonly correlation: string | null;
};

/** The TypeBox schema of a `ValidationIssue`. */
export const ValidationIssueType = Type.Object({
  severity: Type.Enum(["error", "warning"]),
  path: Type.Array(Type.Union([Type.String(), Type.Number()])),
  message: Type.String(),
  source: Type.Optional(
    Type.Object({
      plugin: Type.String(),
      file: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number()),
    }),
  ),
});

/** The TypeBox schema of a `Failure`. */
export const FailureType = Type.Object({
  class: Type.Enum([
    "rate_limit",
    "auth",
    "quota",
    "context_window",
    "overloaded",
    "network",
    "aborted",
    "provider",
    "runner",
  ]),
  message: Type.String(),
  retryAfterMs: Type.Optional(Type.Number()),
});

/** The TypeBox schema of an `SdkErrorWire`. */
export const SdkErrorWireType = Type.Object({
  code: Type.Enum([
    "unauthenticated",
    "denied",
    "unknown",
    "invalid",
    "stale",
    "unavailable",
    "internal",
  ]),
  message: Type.String(),
  hostId: nullable(idSchema<"host">()),
  issues: Type.Array(ValidationIssueType),
  correlation: nullable(Type.String()),
});

/** Validates a `ValidationIssue`. */
export const ValidationIssueSchema: Schema<ValidationIssue> = standard(ValidationIssueType);

/** Validates a `Failure`. */
export const FailureSchema: Schema<Failure> = standard(FailureType);

/** Validates an `SdkErrorWire`. */
export const SdkErrorWireSchema: Schema<SdkErrorWire> = standard(SdkErrorWireType);
