import { Type } from "typebox";
import type { TProperties, TSchema } from "typebox";
import { standard } from "../schema.ts";
import { base64Bytes } from "./base64.ts";
import { ConsoleEntryType, PageInfoType } from "./browser.ts";
import { ConfigurationPatchType, ConfigurationType } from "./configuration.ts";
import { ValidationIssueType } from "./errors.ts";
import { PatchEventType, SessionEventType } from "./events.ts";
import { FileEntryViewType, FileEventType } from "./files.ts";
import { DiffOptionsType, GitCommitViewType, GitScopeType, GitWriteType } from "./git.ts";
import { MoveOptionsType, MoveOutcomeType, SendOptionsType } from "./heads.ts";
import { AuthorityType, PrincipalViewWireType } from "./host.ts";
import { SeqType, idSchema } from "./ids.ts";
import { JobEndType, JobViewType } from "./jobs.ts";
import { JsonType, withJson } from "./json.ts";
import { PositionType, UserContentType } from "./messages.ts";
import { LoginMethodType, ModelAccountType, ModelRefType, ProviderUsageType } from "./models.ts";
import { nullable } from "./nullable.ts";
import { actOutcomeSchema, PlacementType } from "./parts.ts";
import { McpServerConfigType } from "./mcp.ts";
import { PromptOverrideType } from "./plugins.ts";
import { ParentFilterType, pagedSchema } from "./primitives.ts";
import { RunEndType, stopOutcomeSchema } from "./runs.ts";
import { SessionInfoType } from "./sessions.ts";
import { MessageType, UserStatusType, ViewOptionsType } from "./views.ts";
import { WorkspaceInfoType, WorkspaceTargetType } from "./workspaces.ts";

function schemaOf<T extends TSchema>(type: T) {
  return standard(withJson(type));
}

function objectOf<P extends TProperties>(properties: P) {
  return schemaOf(Type.Object(properties));
}

const SESSION = { session: idSchema<"session">() };

const HEAD = { ...SESSION, head: idSchema<"head">() };

const RUN = { ...SESSION, run: idSchema<"run">() };

const RECEIPT = { session: nullable(idSchema<"session">()), receipt: idSchema<"receipt">() };

const PART = { ...SESSION, part: idSchema<"part">() };

const WORKSPACE = { workspace: idSchema<"workspace">() };

const JOB = { ...WORKSPACE, job: idSchema<"job">() };

const PAGE = { ...WORKSPACE, page: idSchema<"page">() };

const PATH = { ...WORKSPACE, path: Type.String() };

const PROVIDER = { provider: Type.String() };

const NAMED_HEAD = { ...SESSION, name: idSchema<"head">() };

const EXPECT_REVISION = Type.Optional(
  Type.Object({ expect: Type.Optional(idSchema<"revision">()) }),
);

const GIT_PATHS = {
  ...WORKSPACE,
  paths: Type.Array(Type.String()),
  options: Type.Optional(GitWriteType),
};

const GIT_COMPARE = { ...WORKSPACE, scope: GitScopeType, options: Type.Optional(DiffOptionsType) };

const QUERY = { ...WORKSPACE, query: Type.String(), limit: Type.Optional(Type.Number()) };

const PLUGIN_FILE = Type.Object({ path: Type.String() });

const JOB_HANDLE = Type.Object({ ...JobViewType.properties, key: nullable(idSchema<"job-key">()) });

const [, , LANDED] = UserStatusType.anyOf;

const [, ...MOVE_FAILURES] = MoveOutcomeType.anyOf;

const NOTHING = schemaOf(Type.Null());

const BYTES = schemaOf(base64Bytes);

const NO_INPUT = objectOf({});

const ON_SESSION = objectOf(SESSION);

const ON_HEAD = objectOf(HEAD);

const ON_RUN = objectOf(RUN);

const ON_RECEIPT = objectOf(RECEIPT);

const ON_PART = objectOf(PART);

const ON_WORKSPACE = objectOf(WORKSPACE);

const ON_JOB = objectOf(JOB);

const ON_PAGE = objectOf(PAGE);

const ON_PATH = objectOf(PATH);

const ON_PROVIDER = objectOf(PROVIDER);

const GIT_PATHS_INPUT = objectOf(GIT_PATHS);

const GIT_COMPARE_INPUT = objectOf(GIT_COMPARE);

const QUERY_INPUT = objectOf(QUERY);

const NAMED_HEAD_INPUT = objectOf({ ...NAMED_HEAD, options: EXPECT_REVISION });

const RECEIPT_ID = objectOf({ receipt: idSchema<"receipt">() });

const WORKSPACE_CHANGE = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("updated") }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

const WORKSPACES = schemaOf(Type.Array(WorkspaceInfoType));

const SESSIONS = schemaOf(Type.Array(SessionInfoType));

const JOBS = schemaOf(Type.Array(JobViewType));

const PAGES = schemaOf(Type.Array(PageInfoType));

export const ConnectionWatchInputSchema = NO_INPUT;

export const ConnectionBlobInputSchema = objectOf({ id: idSchema<"blob">() });

export const ConnectionBlobOutputSchema = BYTES;

export const ModelsListInputSchema = NO_INPUT;

export const ModelsAccountsInputSchema = objectOf({ provider: Type.Optional(Type.String()) });

export const ModelsAccountsOutputSchema = schemaOf(Type.Array(ModelAccountType));

export const ModelsSelectAccountInputSchema = objectOf({ ...PROVIDER, account: Type.String() });

export const ModelsSelectAccountOutputSchema = NOTHING;

export const ModelsUsageInputSchema = NO_INPUT;

export const ModelsUsageOutputSchema = schemaOf(Type.Array(ProviderUsageType));

export const ModelsRefreshInputSchema = objectOf({ provider: Type.Optional(Type.String()) });

export const ModelsRefreshOutputSchema = NOTHING;

export const ModelsSetDefaultInputSchema = objectOf({ ref: ModelRefType });

export const ModelsSetDefaultOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("set") }),
    Type.Object({ kind: Type.Literal("unknown-model") }),
  ]),
);

export const ModelsVerifyInputSchema = ON_PROVIDER;

export const ModelsVerifyOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("verified") }),
    Type.Object({ kind: Type.Literal("unverified") }),
    Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
  ]),
);

export const ModelsLoginInputSchema = objectOf({
  ...PROVIDER,
  method: LoginMethodType,
  label: Type.Optional(Type.String()),
  browser: Type.Optional(Type.Union([Type.Literal("host"), Type.Literal("elsewhere")])),
});

export const ModelsLoginOutputSchema = NOTHING;

export const ModelsLogoutInputSchema = ON_PROVIDER;

export const ModelsLogoutOutputSchema = NOTHING;

export const LoginStepsInputSchema = ON_PROVIDER;

export const LoginStepsOutputSchema = schemaOf(
  Type.Union([
    Type.Object({
      kind: Type.Literal("open"),
      url: Type.String(),
      code: Type.Optional(Type.String()),
    }),
    Type.Object({ kind: Type.Literal("paste"), message: Type.String(), secret: Type.Boolean() }),
    Type.Object({
      kind: Type.Literal("choose"),
      message: Type.String(),
      options: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
    }),
    Type.Object({ kind: Type.Literal("waiting") }),
    Type.Object({ kind: Type.Literal("done") }),
    Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
  ]),
);

export const LoginAnswerInputSchema = objectOf({ ...PROVIDER, code: Type.String() });

export const LoginAnswerOutputSchema = NOTHING;

export const SettingsApplyInputSchema = objectOf({ id: Type.String(), value: JsonType });

export const WorkspacesListInputSchema = NO_INPUT;

export const WorkspacesListOutputSchema = WORKSPACES;

export const WorkspacesInspectInputSchema = objectOf({ target: WorkspaceTargetType });

export const WorkspacesAddInputSchema = objectOf({
  target: WorkspaceTargetType,
  options: Type.Optional(
    Type.Object({
      projectResources: Type.Optional(Type.Boolean()),
      expect: Type.Optional(Type.Object({ identity: idSchema<"environment-identity">() })),
    }),
  ),
});

export const WorkspacesForgetInputSchema = objectOf({ id: idSchema<"workspace">() });

export const SessionsWatchInputSchema = objectOf({
  parents: Type.Optional(ParentFilterType),
  limit: Type.Optional(Type.Number()),
});

export const SessionsWatchOutputSchema = SESSIONS;

export const SessionsCreateInputSchema = objectOf({
  id: Type.Optional(idSchema<"session">()),
  name: Type.Optional(Type.String()),
  workspace: Type.Optional(idSchema<"workspace">()),
  parent: Type.Optional(idSchema<"session">()),
  configuration: Type.Optional(Type.Union([ConfigurationType, ConfigurationPatchType])),
  prompt: Type.Optional(PromptOverrideType),
});

export const SessionsCreateOutputSchema = ON_SESSION;

export const SessionsListInputSchema = objectOf({
  parents: Type.Optional(ParentFilterType),
  cursor: Type.Optional(idSchema<"cursor">()),
  limit: Type.Optional(Type.Number()),
});

export const SessionsListOutputSchema = pagedSchema(SessionInfoType);

export const SessionInfoInputSchema = ON_SESSION;

export const SessionUpdateInputSchema = objectOf({
  ...SESSION,
  patch: Type.Object({
    name: Type.Optional(nullable(Type.String())),
    pinned: Type.Optional(Type.Boolean()),
    archived: Type.Optional(Type.Boolean()),
    workspace: Type.Optional(idSchema<"workspace">()),
  }),
});

export const SessionRemoveInputSchema = ON_SESSION;

export const SessionStopInputSchema = ON_SESSION;

export const SessionStopOutputSchema = objectOf({
  stopped: Type.Array(idSchema<"run">()),
  withdrawn: Type.Array(idSchema<"message">()),
});

export const SessionCommandInputSchema = objectOf({
  ...SESSION,
  name: Type.String(),
  args: Type.Optional(JsonType),
});

export const HeadSendInputSchema = objectOf({
  ...HEAD,
  content: UserContentType,
  options: Type.Optional(SendOptionsType),
});

export const HeadSendOutputSchema = objectOf({
  receipt: idSchema<"receipt">(),
  message: idSchema<"message">(),
});

export const HeadConfigureInputSchema = objectOf({ ...HEAD, patch: ConfigurationPatchType });

export const HeadViewInputSchema = objectOf({ ...HEAD, options: Type.Optional(ViewOptionsType) });

export const HeadWatchInputSchema = objectOf({
  ...HEAD,
  options: Type.Optional(ViewOptionsType),
  after: Type.Optional(SeqType),
});

export const HeadWatchOutputSchema = schemaOf(
  Type.Union([
    SessionEventType,
    PatchEventType,
    Type.Object({
      kind: Type.Literal("revision"),
      head: idSchema<"head">(),
      tip: nullable(idSchema<"commit">()),
      revision: idSchema<"revision">(),
    }),
  ]),
);

export const HeadHistoryInputSchema = objectOf({
  ...HEAD,
  before: idSchema<"message">(),
  limit: Type.Number(),
});

export const HeadHistoryOutputSchema = schemaOf(Type.Array(MessageType));

export const HeadTreeInputSchema = ON_HEAD;

export const HeadMoveInputSchema = objectOf({
  ...HEAD,
  position: PositionType,
  options: Type.Optional(MoveOptionsType),
  id: Type.Optional(idSchema<"receipt">()),
});

export const HeadMoveOutputSchema = RECEIPT_ID;

export const HeadCompactInputSchema = objectOf({
  ...HEAD,
  instructions: Type.Optional(Type.String()),
});

export const HeadCompactOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("started"), message: idSchema<"message">() }),
    Type.Object({ kind: Type.Literal("busy"), run: idSchema<"run">() }),
    Type.Object({ kind: Type.Literal("nothing-to-compact") }),
  ]),
);

export const HeadsCreateInputSchema = objectOf({
  ...NAMED_HEAD,
  input: Type.Optional(Type.Object({ from: Type.Optional(PositionType) })),
});

export const HeadsMergeInputSchema = NAMED_HEAD_INPUT;

export const HeadsRemoveInputSchema = NAMED_HEAD_INPUT;

export const RunStopInputSchema = ON_RUN;

export const RunStopOutputSchema = stopOutcomeSchema(RunEndType);

export const RunSettledInputSchema = ON_RUN;

export const ReceiptStatusInputSchema = ON_RECEIPT;

export const ReceiptStatusOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("pending") }),
    Type.Object({ kind: Type.Literal("settled"), outcome: JsonType }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

export const ReceiptSettledInputSchema = ON_RECEIPT;

export const ReceiptStopInputSchema = ON_RECEIPT;

export const ReceiptStopOutputSchema = stopOutcomeSchema(JsonType);

export const ReceiptLandedInputSchema = ON_RECEIPT;

export const ReceiptLandedOutputSchema = schemaOf(
  Type.Union([LANDED, Type.Object({ kind: Type.Literal("withdrawn") }), ...MOVE_FAILURES]),
);

export const PartsCreateInputSchema = objectOf({
  ...SESSION,
  kind: Type.String(),
  input: Type.Object({
    state: JsonType,
    placement: PlacementType,
    id: Type.Optional(idSchema<"part">()),
  }),
});

export const PartsCreateOutputSchema = objectOf({ part: idSchema<"part">() });

export const PartUpdateInputSchema = objectOf({
  ...PART,
  next: JsonType,
  options: Type.Optional(Type.Object({ version: Type.Optional(Type.Number()) })),
});

export const PartUpdateOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("updated"), version: Type.Number() }),
    Type.Object({ kind: Type.Literal("invalid"), issues: Type.Array(ValidationIssueType) }),
    Type.Object({ kind: Type.Literal("closed") }),
    Type.Object({ kind: Type.Literal("missing") }),
    Type.Object({ kind: Type.Literal("stale") }),
  ]),
);

export const PartActInputSchema = objectOf({ ...PART, action: Type.String(), input: JsonType });

export const PartActOutputSchema = actOutcomeSchema(JsonType);

export const PartAnswerInputSchema = ON_PART;

export const PartAnswerOutputSchema = schemaOf(
  nullable(Type.Object({ action: Type.String(), input: JsonType })),
);

export const PartCloseInputSchema = ON_PART;

export const PartCloseOutputSchema = NOTHING;

export const WorkspaceInfoInputSchema = ON_WORKSPACE;

export const WorkspaceWatchInputSchema = ON_WORKSPACE;

export const McpWatchInputSchema = ON_WORKSPACE;

const ON_SERVER = objectOf({ ...WORKSPACE, server: Type.String() });

export const McpReconnectInputSchema = ON_SERVER;

export const McpSetEnabledInputSchema = objectOf({
  ...WORKSPACE,
  server: Type.String(),
  enabled: Type.Boolean(),
});

export const McpLoginInputSchema = ON_SERVER;

export const McpLoginOutputSchema = objectOf({ login: Type.String() });

export const McpLogoutInputSchema = ON_SERVER;

export const McpAddInputSchema = objectOf({
  ...WORKSPACE,
  server: Type.String(),
  config: McpServerConfigType,
  scope: Type.Enum(["user", "project"]),
});

export const McpRemoveInputSchema = objectOf({
  ...WORKSPACE,
  server: Type.String(),
  scope: Type.Enum(["user", "project"]),
});

export const WorkspaceUpdateInputSchema = objectOf({
  ...WORKSPACE,
  patch: Type.Object({ projectResources: Type.Optional(nullable(Type.Boolean())) }),
});

export const WorkspaceUpdateOutputSchema = WORKSPACE_CHANGE;

export const WorkspaceReloadInputSchema = ON_WORKSPACE;

export const WorkspaceReloadOutputSchema = WORKSPACE_CHANGE;

export const WorkspaceChangesInputSchema = objectOf({ ...WORKSPACE, run: idSchema<"run">() });

export const WorkspacePatchesInputSchema = objectOf({
  ...WORKSPACE,
  run: idSchema<"run">(),
  paths: Type.Array(Type.String()),
  options: Type.Optional(DiffOptionsType),
});

export const WorkspaceFilesInputSchema = ON_WORKSPACE;

export const WorkspaceGitInputSchema = ON_WORKSPACE;

export const WorkspaceBrowserInputSchema = ON_WORKSPACE;

export const JobsStartInputSchema = objectOf({
  ...WORKSPACE,
  command: Type.Optional(Type.String()),
  session: Type.Optional(idSchema<"session">()),
  title: Type.Optional(Type.String()),
  pty: Type.Optional(Type.Object({ columns: Type.Number(), rows: Type.Number() })),
  id: Type.Optional(idSchema<"job">()),
});

export const JobsStartOutputSchema = schemaOf(JOB_HANDLE);

export const JobsRecoverInputSchema = objectOf({ ...WORKSPACE, key: idSchema<"job-key">() });

export const JobsRecoverOutputSchema = schemaOf(
  Type.Union([
    JOB_HANDLE,
    Type.Object({ kind: Type.Literal("ended"), end: JobEndType }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

export const JobsListInputSchema = ON_WORKSPACE;

export const JobsListOutputSchema = JOBS;

export const JobsWatchInputSchema = ON_WORKSPACE;

export const JobsWatchOutputSchema = JOBS;

export const JobWriteInputSchema = ON_JOB;

export const JobWriteOutputSchema = NOTHING;

export const JobOutputInputSchema = ON_JOB;

export const JobResizeInputSchema = objectOf({
  ...JOB,
  size: Type.Object({ columns: Type.Number(), rows: Type.Number() }),
});

export const JobResizeOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("resized") }),
    Type.Object({ kind: Type.Literal("not-pty") }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

export const JobIdleInputSchema = ON_JOB;

export const JobIdleOutputSchema = schemaOf(Type.Boolean());

export const JobStopInputSchema = ON_JOB;

export const JobStopOutputSchema = stopOutcomeSchema(JobEndType);

export const JobSettledInputSchema = ON_JOB;

export const FilesReadInputSchema = ON_PATH;

export const FilesBytesInputSchema = ON_PATH;

export const FilesBytesOutputSchema = BYTES;

export const FilesStatInputSchema = ON_PATH;

export const FilesStatOutputSchema = schemaOf(
  nullable(
    Type.Object({
      kind: Type.Enum(["file", "directory", "symlink"]),
      size: Type.Number(),
      version: idSchema<"file-version">(),
      target: Type.Optional(Type.String()),
    }),
  ),
);

export const FilesWriteInputSchema = objectOf({
  ...PATH,
  options: Type.Optional(
    Type.Object({
      expect: Type.Optional(Type.Union([Type.Literal("absent"), idSchema<"file-version">()])),
      parents: Type.Optional(Type.Boolean()),
    }),
  ),
});

export const FilesRemoveInputSchema = objectOf({
  ...PATH,
  options: Type.Optional(Type.Object({ expect: Type.Optional(idSchema<"file-version">()) })),
});

export const FilesBatchInputSchema = objectOf({
  ...WORKSPACE,
  id: Type.Optional(idSchema<"receipt">()),
  entries: Type.Array(
    Type.Union([
      Type.Object({
        kind: Type.Literal("put"),
        path: Type.String(),
        contents: Type.Union([Type.String(), Type.Object({ blob: idSchema<"blob">() })]),
        expect: Type.Optional(Type.Union([Type.Literal("absent"), idSchema<"file-version">()])),
      }),
      Type.Object({
        kind: Type.Literal("remove"),
        path: Type.String(),
        expect: Type.Optional(idSchema<"file-version">()),
      }),
    ]),
  ),
});

export const FilesBatchOutputSchema = RECEIPT_ID;

export const FilesFormatInputSchema = objectOf({ ...PATH, contents: Type.String() });

export const FilesScanInputSchema = objectOf({
  ...WORKSPACE,
  directory: Type.Optional(Type.String()),
  ignored: Type.Optional(Type.Enum(["exclude", "include"])),
});

export const FilesFindInputSchema = QUERY_INPUT;

export const FilesFindOutputSchema = schemaOf(Type.Array(FileEntryViewType));

export const FilesSearchInputSchema = QUERY_INPUT;

export const FilesWatchInputSchema = objectOf({
  ...WORKSPACE,
  paths: Type.Optional(Type.Array(Type.String())),
});

export const FilesWatchOutputSchema = schemaOf(Type.Array(FileEventType));

export const FilesUploadInputSchema = ON_WORKSPACE;

export const GitStatusInputSchema = ON_WORKSPACE;

export const GitWatchInputSchema = ON_WORKSPACE;

export const GitChangesInputSchema = GIT_COMPARE_INPUT;

export const GitWatchChangesInputSchema = GIT_COMPARE_INPUT;

export const GitPatchesInputSchema = objectOf({ ...GIT_COMPARE, paths: Type.Array(Type.String()) });

export const GitContentsInputSchema = objectOf({ ...PATH, scope: GitScopeType });

export const GitLogInputSchema = objectOf({
  ...WORKSPACE,
  cursor: Type.Optional(idSchema<"cursor">()),
  limit: Type.Optional(Type.Number()),
});

export const GitLogOutputSchema = pagedSchema(GitCommitViewType);

export const GitRefsInputSchema = ON_WORKSPACE;

export const GitBlameInputSchema = ON_PATH;

export const GitStageInputSchema = GIT_PATHS_INPUT;

export const GitUnstageInputSchema = GIT_PATHS_INPUT;

export const GitDiscardInputSchema = GIT_PATHS_INPUT;

export const GitCommitInputSchema = objectOf({
  ...WORKSPACE,
  input: Type.Object({
    message: Type.String(),
    files: Type.Union([Type.Literal("staged"), Type.Literal("all"), Type.Array(Type.String())]),
  }),
  options: Type.Optional(GitWriteType),
});

export const GitBranchInputSchema = objectOf({
  ...WORKSPACE,
  input: Type.Object({ name: Type.String(), checkout: Type.Boolean() }),
  options: Type.Optional(GitWriteType),
});

export const GitPushInputSchema = objectOf({
  ...WORKSPACE,
  input: Type.Optional(Type.Object({ setUpstream: Type.Optional(Type.Boolean()) })),
  options: Type.Optional(GitWriteType),
});

export const BrowserOpenInputSchema = objectOf({
  ...WORKSPACE,
  url: Type.String(),
  id: Type.Optional(Type.String()),
});

export const BrowserAdoptInputSchema = objectOf({ ...WORKSPACE, id: idSchema<"page">() });

export const BrowserListInputSchema = ON_WORKSPACE;

export const BrowserListOutputSchema = PAGES;

export const BrowserWatchInputSchema = ON_WORKSPACE;

export const BrowserWatchOutputSchema = PAGES;

export const PageViewInputSchema = ON_PAGE;

export const PageWatchInputSchema = ON_PAGE;

export const PageSnapshotInputSchema = objectOf({ ...PAGE, ref: Type.Optional(Type.String()) });

export const PageNavigateInputSchema = objectOf({ ...PAGE, url: Type.String() });

export const PageBackInputSchema = ON_PAGE;

export const PageForwardInputSchema = ON_PAGE;

export const PageReloadInputSchema = ON_PAGE;

export const PageStopLoadingInputSchema = ON_PAGE;

export const PageClickInputSchema = objectOf({
  ...PAGE,
  ref: Type.String(),
  button: Type.Optional(Type.Enum(["left", "right", "middle"])),
  double: Type.Optional(Type.Boolean()),
  expect: Type.Optional(idSchema<"document-revision">()),
});

export const PageTypeInputSchema = objectOf({
  ...PAGE,
  ref: Type.String(),
  text: Type.String(),
  clear: Type.Optional(Type.Boolean()),
  submit: Type.Optional(Type.Boolean()),
  expect: Type.Optional(idSchema<"document-revision">()),
});

export const PagePressInputSchema = objectOf({
  ...PAGE,
  key: Type.String(),
  ref: Type.Optional(Type.String()),
});

export const PageScrollInputSchema = objectOf({
  ...PAGE,
  direction: Type.Enum(["up", "down", "top", "bottom"]),
  ref: Type.Optional(Type.String()),
  pages: Type.Optional(Type.Number()),
});

export const PageWaitInputSchema = objectOf({
  ...PAGE,
  condition: Type.Union([
    Type.Object({ kind: Type.Literal("loaded") }),
    Type.Object({ kind: Type.Literal("text"), text: Type.String(), present: Type.Boolean() }),
    Type.Object({ kind: Type.Literal("delay"), ms: Type.Number() }),
  ]),
});

export const PageConsoleInputSchema = objectOf({
  ...PAGE,
  limit: Type.Optional(Type.Number()),
  clear: Type.Optional(Type.Boolean()),
});

export const PageConsoleOutputSchema = schemaOf(Type.Array(ConsoleEntryType));

export const PageCaptureInputSchema = ON_PAGE;

export const PageCaptureOutputSchema = BYTES;

export const PageEvaluateInputSchema = objectOf({
  ...PAGE,
  expression: Type.String(),
  options: Type.Optional(Type.Object({ ref: Type.Optional(Type.String()) })),
});

export const PageEvaluateOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("value"), value: JsonType }),
    Type.Object({ kind: Type.Literal("threw"), message: Type.String() }),
  ]),
);

export const PageCloseInputSchema = ON_PAGE;

export const PageCloseOutputSchema = NOTHING;

export const PluginsReplaceInputSchema = objectOf({
  plugins: Type.Array(PLUGIN_FILE),
  scope: Type.Optional(Type.Object(SESSION)),
});

export const PluginsCheckInputSchema = objectOf({ plugins: Type.Array(PLUGIN_FILE) });

export const PrincipalsListInputSchema = NO_INPUT;

export const PrincipalsListOutputSchema = schemaOf(Type.Array(PrincipalViewWireType));

export const PrincipalsPairInputSchema = objectOf({
  authority: Type.Array(AuthorityType),
  label: Type.Optional(Type.String()),
});

export const PrincipalsPairOutputSchema = objectOf({
  code: Type.String(),
  expiresAt: Type.Number(),
});

export const PrincipalsRevokeInputSchema = objectOf({ id: idSchema<"principal">() });

export const PrincipalsRevokeOutputSchema = NOTHING;
