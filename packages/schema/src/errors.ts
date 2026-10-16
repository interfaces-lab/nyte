import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

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

export type ValidationIssue = Decoded<typeof ValidationIssueType>;

export const FailureClassType = Type.Enum([
  "rate_limit",
  "auth",
  "quota",
  "context_window",
  "overloaded",
  "network",
  "aborted",
  "provider",
  "runner",
]);

export type FailureClass = Decoded<typeof FailureClassType>;

export const FailureType = Type.Object({
  class: FailureClassType,
  message: Type.String(),
  retryAfterMs: Type.Optional(Type.Number()),
});

export type Failure = Decoded<typeof FailureType>;

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

export type SdkErrorWire = Decoded<typeof SdkErrorWireType>;

export const ValidationIssueSchema: Schema<ValidationIssue> = standard(ValidationIssueType);

export const FailureSchema: Schema<Failure> = standard(FailureType);

export const SdkErrorWireSchema: Schema<SdkErrorWire> = standard(SdkErrorWireType);
