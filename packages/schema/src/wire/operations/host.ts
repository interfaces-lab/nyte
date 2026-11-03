import { Type } from "typebox";
import { ConfigurationPatchType, ConfigurationType } from "../../configuration.ts";
import { HostViewWireSchema, SettingOutcomeSchema } from "../../connection.ts";
import {
  AuthorityType,
  McpAccessType,
  McpGrantViewType,
  OperationDescriptionType,
  PluginCheckReportSchema,
  PluginReplacementReportSchema,
  PrincipalViewWireType,
  TailnetSettingsType,
  TailnetStatusType,
} from "../../host.ts";
import { idSchema } from "../../ids.ts";
import { JsonType } from "../../json.ts";
import { UserContentType } from "../../messages.ts";
import {
  LoginMethodType,
  ModelAccountType,
  ModelCatalogViewSchema,
  ModelListingType,
  ModelRefType,
  ProviderUsageType,
} from "../../models.ts";
import { PromptOverrideType } from "../../plugins.ts";
import { pagedSchema, ParentFilterType } from "../../primitives.ts";
import { SessionInfoType, SessionsReadType } from "../../sessions.ts";
import {
  AddOutcomeSchema,
  ForgetOutcomeSchema,
  WorkspaceInfoType,
  WorkspaceInspectionSchema,
  WorkspaceTargetType,
  WorktreeCleanupSchema,
} from "../../workspaces.ts";
import { BYTES, NOTHING, SESSION, wireObject, wireSchema } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const PARTICIPANT = { authority: "participant", scope: "host" } as const;

const OWNER = { authority: "owner", scope: "host" } as const;

const MAINTENANCE = { authority: "maintenance", scope: "host" } as const;

const LOCAL_OWNER = { ...OWNER, local: true } as const;

const PROVIDER = { provider: Type.String() };

const PLUGIN_FILE = Type.Object({ path: Type.String() });

const NO_INPUT = wireObject({});

const ON_PROVIDER = wireObject(PROVIDER);

export const HOST_OPERATIONS = {
  "connection.watch": {
    ...PARTICIPANT,
    summary: "Streams the host's state, including its model catalog, each time it changes.",
    kind: "watch",
    input: NO_INPUT,
    output: HostViewWireSchema,
  },
  "connection.blob": {
    ...PARTICIPANT,
    summary: "Streams the bytes of a stored blob, such as an image attached to a message.",
    kind: "stream",
    input: wireObject({ id: idSchema<"blob">() }),
    output: BYTES,
  },
  "operations.describe": {
    ...PARTICIPANT,
    summary:
      "Describes the operations this host serves, or the ones named, with their access and wire JSON Schemas.",
    kind: "query",
    input: wireObject({ names: Type.Optional(Type.Array(Type.String())) }),
    output: wireSchema(Type.Array(OperationDescriptionType)),
  },
  "models.list": {
    ...PARTICIPANT,
    summary:
      "Lists saved models, the default selection and each provider's last known credentials.",
    kind: "query",
    input: NO_INPUT,
    output: ModelCatalogViewSchema,
  },
  "models.accounts": {
    ...OWNER,
    summary: "Lists saved logins for one provider, or for every provider.",
    kind: "query",
    input: wireObject({ provider: Type.Optional(Type.String()) }),
    output: wireSchema(Type.Array(ModelAccountType)),
  },
  "models.selectAccount": {
    ...OWNER,
    summary: "Makes a saved login the active one for a provider's future requests.",
    kind: "command",
    input: wireObject({ ...PROVIDER, account: Type.String() }),
    output: NOTHING,
  },
  "models.renameAccount": {
    ...OWNER,
    summary: "Renames a saved login; the name must not be empty.",
    kind: "command",
    input: wireObject({ ...PROVIDER, account: Type.String(), label: Type.String() }),
    output: NOTHING,
  },
  "models.usage": {
    ...OWNER,
    summary: "Returns each provider's usage, refreshing entries that have expired.",
    kind: "query",
    input: NO_INPUT,
    output: wireSchema(Type.Array(ProviderUsageType)),
  },
  "models.refresh": {
    ...OWNER,
    summary: "Refreshes the model list and credentials for one provider, or for every provider.",
    kind: "command",
    input: wireObject({ provider: Type.Optional(Type.String()) }),
    output: NOTHING,
  },
  "models.setDefault": {
    ...OWNER,
    summary: "Sets the model new chats use by default.",
    kind: "command",
    input: wireObject({ ref: ModelRefType }),
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("set") }),
        Type.Object({ kind: Type.Literal("unknown-model") }),
      ]),
    ),
  },
  "models.setListing": {
    ...OWNER,
    summary: "Shows, hides or favorites models in the model list.",
    kind: "command",
    input: wireObject({ refs: Type.Array(ModelRefType), listing: ModelListingType }),
    output: wireSchema(
      Type.Union([
        Type.Object({ kind: Type.Literal("set") }),
        Type.Object({ kind: Type.Literal("unknown-model") }),
      ]),
    ),
  },
  "models.verify": {
    ...OWNER,
    summary: "Checks that a provider's current credentials work.",
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
    summary: "Starts signing in to a provider; follow it with `login.steps`.",
    kind: "command",
    input: wireObject({
      ...PROVIDER,
      method: LoginMethodType,
      label: Type.Optional(Type.String()),
      browser: Type.Optional(Type.Union([Type.Literal("host"), Type.Literal("elsewhere")])),
    }),
    output: NOTHING,
  },
  "models.logout": {
    ...OWNER,
    summary: "Removes a provider's active login and keeps its other saved accounts.",
    kind: "command",
    input: ON_PROVIDER,
    output: NOTHING,
  },
  "login.steps": {
    ...OWNER,
    summary: "Streams the steps of a provider sign-in in progress until it is done or fails.",
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
    summary: "Sends a code the user pasted to a provider sign-in in progress.",
    kind: "command",
    input: wireObject({ ...PROVIDER, code: Type.String() }),
    output: NOTHING,
  },
  "settings.apply": {
    ...OWNER,
    summary: "Sets a setting to a new value and returns whether it was applied.",
    kind: "command",
    input: wireObject({ id: Type.String(), value: JsonType }),
    output: SettingOutcomeSchema,
  },
  "workspaces.list": {
    ...PARTICIPANT,
    mcp: "read",
    summary: "Lists the workspaces the host knows.",
    kind: "query",
    input: NO_INPUT,
    output: wireSchema(Type.Array(WorkspaceInfoType)),
  },
  "workspaces.inspect": {
    ...OWNER,
    summary: "Reads a folder or other target before it is added as a workspace.",
    kind: "query",
    input: wireObject({ target: WorkspaceTargetType }),
    output: WorkspaceInspectionSchema,
  },
  "workspaces.add": {
    ...OWNER,
    summary: "Adds a folder or other target as a workspace.",
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
    summary: "Forgets a workspace unless a session still uses it.",
    kind: "command",
    input: wireObject({ id: idSchema<"workspace">() }),
    output: ForgetOutcomeSchema,
  },
  "workspaces.cleanWorktrees": {
    ...OWNER,
    summary: "Removes leftover worktrees with no changes and returns how many it cleaned.",
    kind: "command",
    input: NO_INPUT,
    output: WorktreeCleanupSchema,
  },
  "sessions.start": {
    ...PARTICIPANT,
    mcp: "write",
    summary: "Starts a chat with its first message.",
    kind: "receipt",
    recovery: "replay",
    input: wireObject({
      id: idSchema<"session">(),
      name: Type.Optional(Type.String()),
      workspace: Type.Optional(idSchema<"workspace">()),
      parent: Type.Optional(idSchema<"session">()),
      configuration: Type.Optional(Type.Union([ConfigurationType, ConfigurationPatchType])),
      prompt: Type.Optional(PromptOverrideType),
      isolation: Type.Optional(Type.Literal("worktree")),
      contextFiles: Type.Optional(Type.Literal(false)),
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
    mcp: "read",
    summary: "Lists the host's sessions one page at a time.",
    kind: "query",
    input: wireObject({
      parents: Type.Optional(ParentFilterType),
      cursor: Type.Optional(idSchema<"cursor">()),
      limit: Type.Optional(Type.Number()),
    }),
    output: pagedSchema(SessionInfoType),
  },
  "sessions.read": {
    ...PARTICIPANT,
    summary:
      "Reads the host's sessions table: the ids a filter selects and every row changed since a seq.",
    kind: "query",
    input: wireObject({
      parents: Type.Optional(ParentFilterType),
      limit: Type.Optional(Type.Number()),
      resume: Type.Optional(Type.Object({ seq: Type.Number() })),
    }),
    output: wireSchema(SessionsReadType),
  },
  "host.tailnet.status": {
    ...LOCAL_OWNER,
    summary: "Returns the status of the host's embedded tailnet node.",
    kind: "query",
    input: NO_INPUT,
    output: wireSchema(TailnetStatusType),
  },
  "host.tailnet.configure": {
    ...LOCAL_OWNER,
    summary:
      "Saves the embedded tailnet node's settings and restarts it, signing in with the auth key when one is given; the key is passed to the node once and never saved.",
    kind: "command",
    input: wireObject({ ...TailnetSettingsType.properties, authKey: Type.Optional(Type.String()) }),
    output: wireSchema(TailnetStatusType),
  },
  "host.tailnet.logout": {
    ...LOCAL_OWNER,
    summary: "Signs the embedded tailnet node out and turns it off.",
    kind: "command",
    input: NO_INPUT,
    output: wireSchema(TailnetStatusType),
  },
  "host.execution.pause": {
    ...LOCAL_OWNER,
    summary:
      "Ends the host's model streams in flight and holds new requests until resumed, as while the machine sleeps; runs stay live.",
    kind: "command",
    input: NO_INPUT,
    output: NOTHING,
  },
  "host.execution.resume": {
    ...LOCAL_OWNER,
    summary: "Lets the runs a pause held request again.",
    kind: "command",
    input: NO_INPUT,
    output: NOTHING,
  },
  "mcp.approve": {
    ...LOCAL_OWNER,
    summary:
      "Approves the MCP sign-in waiting with this code, for read-only tools or for write tools under an approval policy ceiling.",
    kind: "command",
    input: wireObject({ code: Type.String(), access: McpAccessType }),
    output: wireObject({ client: Type.String() }),
  },
  "mcp.deny": {
    ...LOCAL_OWNER,
    summary: "Refuses the MCP sign-in waiting with this code.",
    kind: "command",
    input: wireObject({ code: Type.String() }),
    output: NOTHING,
  },
  "mcp.grants.list": {
    ...LOCAL_OWNER,
    summary: "Lists the MCP clients this host granted access to.",
    kind: "query",
    input: NO_INPUT,
    output: wireSchema(Type.Array(McpGrantViewType)),
  },
  "mcp.grants.revoke": {
    ...LOCAL_OWNER,
    summary: "Revokes an MCP client's grant and every token issued under it.",
    kind: "command",
    input: wireObject({ id: Type.String() }),
    output: NOTHING,
  },
} as const satisfies OperationRows;

export const MAINTENANCE_OPERATIONS = {
  "plugins.replace": {
    ...MAINTENANCE,
    summary: "Replaces the loaded plugins, for the whole host or one session.",
    kind: "command",
    input: wireObject({
      plugins: Type.Array(PLUGIN_FILE),
      scope: Type.Optional(Type.Object(SESSION)),
    }),
    output: PluginReplacementReportSchema,
  },
  "plugins.check": {
    ...MAINTENANCE,
    summary: "Loads plugin files and reports their problems without activating them.",
    kind: "query",
    input: wireObject({ plugins: Type.Array(PLUGIN_FILE) }),
    output: PluginCheckReportSchema,
  },
  "principals.list": {
    ...MAINTENANCE,
    summary: "Lists the clients paired with this host.",
    kind: "query",
    input: NO_INPUT,
    output: wireSchema(Type.Array(PrincipalViewWireType)),
  },
  "principals.pair": {
    ...MAINTENANCE,
    summary: "Creates a short-lived pairing code that grants a new client the given access.",
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
    summary: "Revokes a paired client's access.",
    kind: "command",
    input: wireObject({ id: idSchema<"principal">() }),
    output: NOTHING,
  },
} as const satisfies OperationRows;
