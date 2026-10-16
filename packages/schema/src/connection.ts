import { Type } from "typebox";
import { ValidationIssueType } from "./errors.ts";
import { SendOptionsType } from "./heads.ts";
import { AuthorityType } from "./host.ts";
import type { Authority } from "./host.ts";
import { idSchema } from "./ids.ts";
import { withJson } from "./json.ts";
import { UserContentType } from "./messages.ts";
import type { Awaitable } from "./primitives.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { SettingInfoType } from "./sessions.ts";
import { nullable } from "./wire/nullable.ts";

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

export type HostViewWire = Decoded<typeof HostViewWireType>;

export const CredentialSourceWireType = Type.Union([
  Type.Object({ kind: Type.Literal("token"), token: Type.String() }),
  Type.Object({ kind: Type.Literal("pairing"), code: Type.String() }),
]);

export type CredentialSourceWire = Decoded<typeof CredentialSourceWireType>;

export const JournalEntryType = Type.Object({
  id: idSchema<"receipt">(),
  session: idSchema<"session">(),
  head: idSchema<"head">(),
  content: UserContentType,
  options: SendOptionsType,
  at: Type.Number(),
});

export type JournalEntry = Decoded<typeof JournalEntryType>;

export const SettingOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("applied") }),
  Type.Object({ kind: Type.Literal("invalid"), issues: Type.Array(ValidationIssueType) }),
  Type.Object({ kind: Type.Literal("unknown") }),
]);

export type SettingOutcome = Decoded<typeof SettingOutcomeType>;

export const HostViewWireSchema: Schema<HostViewWire> = standard(withJson(HostViewWireType));

export const CredentialSourceWireSchema: Schema<CredentialSourceWire> =
  standard(CredentialSourceWireType);

export const JournalEntrySchema: Schema<JournalEntry> = standard(withJson(JournalEntryType));

export const SettingOutcomeSchema: Schema<SettingOutcome> = standard(SettingOutcomeType);

/** A host as the client holds it: the wire view, its authority as a set and without the connection's principal. */
export type HostView = Omit<HostViewWire, "authority" | "principal"> & {
  readonly authority: ReadonlySet<Authority>;
};

/** How the client proves who it is: a credential the wire carries, or headers a `custom` source computes. */
export type CredentialSource =
  | CredentialSourceWire
  | { readonly kind: "custom"; headers(): Awaitable<Readonly<Record<string, string>>> };
