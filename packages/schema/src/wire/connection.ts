import { Type } from "typebox";
import type { CredentialSource, HostView, JournalEntry, SettingOutcome } from "../connection.ts";
import type { Authority } from "../declaration.ts";
import type { PrincipalId } from "../ids.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { ValidationIssueType } from "./errors.ts";
import { SendOptionsType } from "./heads.ts";
import { AuthorityType } from "./host.ts";
import { idSchema } from "./ids.ts";
import { withJson } from "./json.ts";
import { UserContentType } from "./messages.ts";
import { nullable } from "./nullable.ts";
import { SettingInfoType } from "./sessions.ts";

export type HostViewWire = Omit<HostView, "authority"> & {
  readonly authority: readonly Authority[];
  readonly principal: PrincipalId;
};

export type CredentialSourceWire = Exclude<CredentialSource, { readonly kind: "custom" }>;

export const HostViewWireType = Type.Object({
  id: idSchema<"host">(),
  link: Type.Union([
    Type.Object({ kind: Type.Literal("connected") }),
    Type.Object({
      kind: Type.Literal("reconnecting"),
      since: Type.Number(),
      attempts: Type.Number(),
    }),
    Type.Object({
      kind: Type.Literal("closed"),
      reason: Type.Enum(["client", "revoked", "host-gone"]),
    }),
  ]),
  name: Type.String(),
  platform: Type.String(),
  version: Type.String(),
  catalog: idSchema<"catalog-generation">(),
  plugins: Type.Array(
    Type.Object({
      id: Type.String(),
      source: Type.Enum(["builtin", "user", "project", "inline"]),
      path: nullable(Type.String()),
      issues: Type.Array(ValidationIssueType),
    }),
  ),
  settings: Type.Array(SettingInfoType),
  authority: Type.Array(AuthorityType),
  principal: idSchema<"principal">(),
});

export const CredentialSourceWireType = Type.Union([
  Type.Object({ kind: Type.Literal("token"), token: Type.String() }),
  Type.Object({ kind: Type.Literal("pairing"), code: Type.String() }),
]);

export const JournalEntryType = Type.Object({
  id: idSchema<"receipt">(),
  session: idSchema<"session">(),
  head: idSchema<"head">(),
  content: UserContentType,
  options: SendOptionsType,
  at: Type.Number(),
});

export const SettingOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("applied") }),
  Type.Object({ kind: Type.Literal("invalid"), issues: Type.Array(ValidationIssueType) }),
  Type.Object({ kind: Type.Literal("unknown") }),
]);

export const HostViewWireSchema: Schema<HostViewWire> = standard(withJson(HostViewWireType));

export const CredentialSourceWireSchema: Schema<CredentialSourceWire> =
  standard(CredentialSourceWireType);

export const JournalEntrySchema: Schema<JournalEntry> = standard(withJson(JournalEntryType));

export const SettingOutcomeSchema: Schema<SettingOutcome> = standard(SettingOutcomeType);
