export { ALL_AUTHORITY, IMAGE_LIMITS, LOCAL } from "./contract/host.ts";

export type {
  ConnectOptions,
  Connection,
  ConnectionContext,
  DocumentsApi,
  Host,
  ImageLimits,
  ImageProcessor,
  ListenOptions,
  Listener,
  Login,
  ModelsApi,
  OpenOptions,
  OperationsApi,
  Project,
  Projects,
  PluginDirectory,
  PluginFile,
  PluginStorage,
  PluginsApi,
  PreparedImage,
  PrincipalsApi,
  RequestJournal,
  SettingsApi,
  ViewBuild,
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
  SecretEntry,
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

export { changesSince, readWindow } from "./fold/window.ts";

export type {
  FoldCheckpoint,
  FoldCheckpoints,
  ObjectStore,
  RefStore,
  SessionIndex,
  SessionIndexRow,
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

export { onlyNyteAppHas } from "./engine/surface.ts";

export { processEnvironment } from "./util/process-environment.ts";

export { bashProperties } from "./builtins/environment.ts";

export { dev, fault } from "./util/dev-log.ts";

export type { DevRow, Fault } from "./util/dev-log.ts";

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

export { closable, coalesce, forwarded } from "./util/iterable.ts";

export { matchesOutput } from "./util/json-schema.ts";

export { fitsActionOutput, fitsAnswer, fitsState } from "./api/part-schema.ts";

export { callable } from "./util/callable.ts";

export { lineDiff } from "./util/line-diff.ts";

export { CLIP_CHARS, clipText, excerptText } from "./util/clip.ts";
