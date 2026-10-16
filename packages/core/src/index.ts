export { ALL_AUTHORITY, LOCAL } from "./contract/host.ts";

export type {
  ConnectOptions,
  Connection,
  ConnectionContext,
  Host,
  ListenOptions,
  Listener,
  Login,
  ModelsApi,
  OpenOptions,
  PluginFile,
  PluginStorage,
  PluginsApi,
  PrincipalsApi,
  RequestJournal,
  SettingsApi,
} from "./contract/host.ts";

export {
  branchSummary,
  compaction,
  definePart,
  isPart,
  text,
  thinking,
  tool,
} from "./contract/parts.ts";

export type {
  ActionContext,
  ActionOutput,
  ActionSchemas,
  Part,
  PartActions,
  PartDefinition,
  PartState,
} from "./contract/parts.ts";

export type {
  Agent,
  Available,
  ClientApi,
  Command,
  ContributionTable,
  Decide,
  Declared,
  HookEntry,
  HookHandler,
  HookName,
  HookTable,
  Keybinding,
  ModelContextPolicy,
  Observe,
  Plugin,
  PluginApi,
  PromptSection,
  Registries,
  Registry,
  RegistryDraft,
  Renderer,
  Row,
  Setting,
  SettingDefinition,
  Side,
  SideTable,
  Skill,
  Transform,
} from "./contract/plugin.ts";

export type { Head, Receipt, Run, SendReceipt, Session, Sessions } from "./contract/session.ts";

export type {
  ObjectStore,
  RefStore,
  SessionIndex,
  Store,
  StoreConnection,
} from "./contract/store.ts";

export type { Durable, ToolDefinition, ToolInvocation } from "./contract/tools.ts";

export type {
  BrowserApi,
  EnvironmentProvider,
  EnvironmentWrap,
  ExecutionEnv,
  FileBatch,
  FilesApi,
  GitApi,
  Job,
  Jobs,
  McpApi,
  Page,
  Resources,
  SnapshotsApi,
  Workspace,
  Workspaces,
} from "./contract/workspace.ts";

export { processEnvironment } from "./util/process-environment.ts";

export { dev } from "./util/dev-log.ts";

export type { DevRow } from "./util/dev-log.ts";

export { SdkError } from "./util/error.ts";

export type { SdkErrorCode } from "./util/error.ts";

export { closable, coalesce } from "./util/iterable.ts";

export { isJsonObject, matchesOutput } from "./util/json-schema.ts";

export { lineDiff } from "./util/line-diff.ts";
