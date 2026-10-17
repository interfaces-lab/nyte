import { Type } from "typebox";
import { ConfigurationPatchType, ConfigurationType } from "../../configuration.ts";
import { HostViewWireSchema, SettingOutcomeSchema } from "../../connection.ts";
import {
  AuthorityType,
  PluginCheckReportSchema,
  PluginReplacementReportSchema,
  PrincipalViewWireType,
} from "../../host.ts";
import { idSchema } from "../../ids.ts";
import { JsonType } from "../../json.ts";
import { UserContentType } from "../../messages.ts";
import {
  LoginMethodType,
  ModelAccountType,
  ModelCatalogViewSchema,
  ModelRefType,
  ProviderUsageType,
} from "../../models.ts";
import { PromptOverrideType } from "../../plugins.ts";
import { pagedSchema, ParentFilterType } from "../../primitives.ts";
import { SessionInfoType } from "../../sessions.ts";
import {
  AddOutcomeSchema,
  ForgetOutcomeSchema,
  WorkspaceInfoType,
  WorkspaceInspectionSchema,
  WorkspaceTargetType,
} from "../../workspaces.ts";
import { BYTES, NOTHING, SESSION, wireObject, wireSchema } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const PARTICIPANT = { authority: "participant", scope: "host" } as const;

const OWNER = { authority: "owner", scope: "host" } as const;

const MAINTENANCE = { authority: "maintenance", scope: "host" } as const;

const PROVIDER = { provider: Type.String() };

const PLUGIN_FILE = Type.Object({ path: Type.String() });

const NO_INPUT = wireObject({});

const ON_PROVIDER = wireObject(PROVIDER);

export const HOST_OPERATIONS = {
  "connection.watch": {
    ...PARTICIPANT,
    kind: "watch",
    input: NO_INPUT,
    output: HostViewWireSchema,
  },
  "connection.blob": {
    ...PARTICIPANT,
    kind: "stream",
    input: wireObject({ id: idSchema<"blob">() }),
    output: BYTES,
  },
  "models.list": { ...PARTICIPANT, kind: "query", input: NO_INPUT, output: ModelCatalogViewSchema },
  "models.accounts": {
    ...OWNER,
    kind: "query",
    input: wireObject({ provider: Type.Optional(Type.String()) }),
    output: wireSchema(Type.Array(ModelAccountType)),
  },
  "models.selectAccount": {
    ...OWNER,
    kind: "command",
    input: wireObject({ ...PROVIDER, account: Type.String() }),
    output: NOTHING,
  },
  "models.usage": {
    ...OWNER,
    kind: "query",
    input: NO_INPUT,
    output: wireSchema(Type.Array(ProviderUsageType)),
  },
  "models.refresh": {
    ...OWNER,
    kind: "command",
    input: wireObject({ provider: Type.Optional(Type.String()) }),
    output: NOTHING,
  },
  "models.setDefault": {
    ...OWNER,
    kind: "command",
    input: wireObject({ ref: ModelRefType }),
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("set") }),
        Type.Object({ kind: Type.Literal("unknown-model") }),
      ]),
    ),
  },
  "models.verify": {
    ...OWNER,
    kind: "command",
    input: ON_PROVIDER,
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("verified") }),
        Type.Object({ kind: Type.Literal("unverified") }),
        Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
      ]),
    ),
  },
  "models.login": {
    ...OWNER,
    kind: "command",
    input: wireObject({
      ...PROVIDER,
      method: LoginMethodType,
      label: Type.Optional(Type.String()),
      browser: Type.Optional(Type.Union([Type.Literal("host"), Type.Literal("elsewhere")])),
    }),
    output: NOTHING,
  },
  "models.logout": { ...OWNER, kind: "command", input: ON_PROVIDER, output: NOTHING },
  "login.steps": {
    ...OWNER,
    kind: "stream",
    input: ON_PROVIDER,
    output: wireSchema(
      Type.Union([
        Type.Object({
          kind: Type.Literal("open"),
          url: Type.String(),
          code: Type.Optional(Type.String()),
        }),
        Type.Object({
          kind: Type.Literal("paste"),
          message: Type.String(),
          secret: Type.Boolean(),
        }),
        Type.Object({
          kind: Type.Literal("choose"),
          message: Type.String(),
          options: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
        }),
        Type.Object({ kind: Type.Literal("waiting") }),
        Type.Object({ kind: Type.Literal("done") }),
        Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
      ]),
    ),
  },
  "login.answer": {
    ...OWNER,
    kind: "command",
    input: wireObject({ ...PROVIDER, code: Type.String() }),
    output: NOTHING,
  },
  "settings.apply": {
    ...OWNER,
    kind: "command",
    input: wireObject({ id: Type.String(), value: JsonType }),
    output: SettingOutcomeSchema,
  },
  "workspaces.list": {
    ...PARTICIPANT,
    kind: "query",
    input: NO_INPUT,
    output: wireSchema(Type.Array(WorkspaceInfoType)),
  },
  "workspaces.inspect": {
    ...OWNER,
    kind: "query",
    input: wireObject({ target: WorkspaceTargetType }),
    output: WorkspaceInspectionSchema,
  },
  "workspaces.add": {
    ...OWNER,
    kind: "command",
    input: wireObject({
      target: WorkspaceTargetType,
      options: Type.Optional(
        Type.Object({
          projectResources: Type.Optional(Type.Boolean()),
          expect: Type.Optional(Type.Object({ identity: idSchema<"environment-identity">() })),
        }),
      ),
    }),
    output: AddOutcomeSchema,
  },
  "workspaces.forget": {
    ...OWNER,
    kind: "command",
    input: wireObject({ id: idSchema<"workspace">() }),
    output: ForgetOutcomeSchema,
  },
  "sessions.watch": {
    ...PARTICIPANT,
    kind: "watch",
    input: wireObject({
      parents: Type.Optional(ParentFilterType),
      limit: Type.Optional(Type.Number()),
    }),
    output: wireSchema(Type.Array(SessionInfoType)),
  },
  "sessions.start": {
    ...PARTICIPANT,
    kind: "receipt",
    recovery: "replay",
    input: wireObject({
      id: idSchema<"session">(),
      name: Type.Optional(Type.String()),
      workspace: Type.Optional(idSchema<"workspace">()),
      parent: Type.Optional(idSchema<"session">()),
      configuration: Type.Optional(Type.Union([ConfigurationType, ConfigurationPatchType])),
      prompt: Type.Optional(PromptOverrideType),
      content: UserContentType,
    }),
    output: wireObject({
      session: idSchema<"session">(),
      receipt: idSchema<"receipt">(),
      message: idSchema<"message">(),
    }),
  },
  "sessions.list": {
    ...PARTICIPANT,
    kind: "query",
    input: wireObject({
      parents: Type.Optional(ParentFilterType),
      cursor: Type.Optional(idSchema<"cursor">()),
      limit: Type.Optional(Type.Number()),
    }),
    output: pagedSchema(SessionInfoType),
  },
} as const satisfies OperationRows;

export const MAINTENANCE_OPERATIONS = {
  "plugins.replace": {
    ...MAINTENANCE,
    kind: "command",
    input: wireObject({
      plugins: Type.Array(PLUGIN_FILE),
      scope: Type.Optional(Type.Object(SESSION)),
    }),
    output: PluginReplacementReportSchema,
  },
  "plugins.check": {
    ...MAINTENANCE,
    kind: "query",
    input: wireObject({ plugins: Type.Array(PLUGIN_FILE) }),
    output: PluginCheckReportSchema,
  },
  "principals.list": {
    ...MAINTENANCE,
    kind: "query",
    input: NO_INPUT,
    output: wireSchema(Type.Array(PrincipalViewWireType)),
  },
  "principals.pair": {
    ...MAINTENANCE,
    kind: "command",
    input: wireObject({
      authority: Type.Array(AuthorityType),
      label: Type.Optional(Type.String()),
    }),
    output: wireObject({
      code: Type.String(),
      expiresAt: Type.Number(),
    }),
  },
  "principals.revoke": {
    ...MAINTENANCE,
    kind: "command",
    input: wireObject({ id: idSchema<"principal">() }),
    output: NOTHING,
  },
} as const satisfies OperationRows;
