import { Type } from "typebox";
import { ValidationIssueType } from "./errors.ts";
import { SendOptionsType } from "./heads.ts";
import { AuthorityType, TailnetStatusType } from "./host.ts";
import type { Authority } from "./host.ts";
import { idSchema } from "./ids.ts";
import { withJson } from "./json.ts";
import { UserContentType } from "./messages.ts";
import type { Awaitable } from "./primitives.ts";
import { ProjectInfoType } from "./projects.ts";
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
  views: Type.Array(
    Type.Object({
      kind: Type.String(),
      plugin: Type.String(),
      runtime: Type.Integer({ minimum: 1 }),
      blob: idSchema<"blob">(),
    }),
  ),
  /** The workspace a session created without one runs in (Home), or null when the host has none. */
  defaultWorkspace: nullable(idSchema<"workspace">()),
  /** Every project on the host, archived ones included, oldest first. */
  projects: Type.Array(ProjectInfoType),
  authority: Type.Array(AuthorityType),
  principal: idSchema<"principal">(),
  tailnet: Type.Optional(TailnetStatusType),
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

export type HostView = Omit<HostViewWire, "authority" | "principal"> & {
  readonly authority: ReadonlySet<Authority>;
  readonly operations: string | null;
};

export type CredentialSource =
  | CredentialSourceWire
  | { readonly kind: "custom"; headers(): Awaitable<Readonly<Record<string, string>>> };
