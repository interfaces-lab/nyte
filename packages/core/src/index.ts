export { ALL_AUTHORITY, IMAGE_LIMITS, LOCAL } from "./contract/host.ts";

export type {
  ConnectOptions,
  Connection,
  ConnectionContext,
  Host,
  ImageLimits,
  ImageProcessor,
  ListenOptions,
  Listener,
  Login,
  ModelsApi,
  OpenOptions,
  PluginFile,
  PluginStorage,
  PluginsApi,
  PreparedImage,
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
  RuntimeCall,
  RuntimeVerdict,
  SearchProvider,
  SearchResult,
  Setting,
  SettingDefinition,
  Side,
  SideTable,
  Skill,
  Transform,
} from "./contract/plugin.ts";

export type {
  Head,
  HeldMessage,
  HoldOutcome,
  Receipt,
  ReleaseOutcome,
  Run,
  SendReceipt,
  Session,
  Sessions,
} from "./contract/session.ts";

export { holdMessage } from "./api/hold.ts";

export type {
  FoldCheckpoint,
  FoldCheckpoints,
  ObjectStore,
  RefStore,
  SessionIndex,
  Store,
  StoreConnection,
} from "./contract/store.ts";

export type {
  Durable,
  ForegroundJobs,
  ToolDefinition,
  ToolInvocation,
  ToolNamespace,
} from "./contract/tools.ts";

export type {
  BrowserApi,
  EnvironmentProvider,
  EnvironmentWrap,
  ExecutionEnv,
  FileBatch,
  FilesApi,
  GitApi,
  GitHubAccountApi,
  GitHubApi,
  Job,
  Jobs,
  McpApi,
  Page,
  Resources,
  SnapshotsApi,
  Workspace,
  Workspaces,
  Worktree,
  WorktreeProvider,
  WorktreeRemoval,
} from "./contract/workspace.ts";

export { attachFile } from "./env/attach.ts";

export { processEnvironment } from "./util/process-environment.ts";

export { bashProperties } from "./builtins/environment.ts";

export { dev } from "./util/dev-log.ts";

export type { DevRow } from "./util/dev-log.ts";

export {
  clearSpans,
  enableTracing,
  followTrace,
  followedTrace,
  readSpans,
  readTraceparent,
  SPAN_NAMES,
  startSpan,
  traced,
  traceparent,
  tracing,
} from "./util/trace.ts";

export type { EndSpan, Span, SpanDetail, SpanName } from "./util/trace.ts";

export { closable, coalesce, forwarded, watchStore } from "./util/iterable.ts";

export type { WatchStore } from "./util/iterable.ts";

export { matchesOutput } from "./util/json-schema.ts";

export { fitsActionOutput, fitsAnswer, fitsState } from "./api/part-schema.ts";

export { callable } from "./util/callable.ts";

export { lineDiff } from "./util/line-diff.ts";
