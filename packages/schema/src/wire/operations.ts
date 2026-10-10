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
import { LoginMethodType, ModelRefType } from "./models.ts";
import { nullable } from "./nullable.ts";
import { actOutcomeSchema, PlacementType } from "./parts.ts";
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

/** Validates `connection.watch`'s input. */
export const ConnectionWatchInputSchema = NO_INPUT;

/** Validates `connection.blob`'s input. */
export const ConnectionBlobInputSchema = objectOf({ id: idSchema<"blob">() });

/** Validates one frame of `connection.blob`'s output: bytes, base64 inside JSON, raw in an octet stream. */
export const ConnectionBlobOutputSchema = BYTES;

/** Validates `models.list`'s input. */
export const ModelsListInputSchema = NO_INPUT;

/** Validates `models.refresh`'s input. */
export const ModelsRefreshInputSchema = objectOf({ provider: Type.Optional(Type.String()) });

/** Validates `models.refresh`'s output: nothing. */
export const ModelsRefreshOutputSchema = NOTHING;

/** Validates `models.setDefault`'s input. */
export const ModelsSetDefaultInputSchema = objectOf({ ref: ModelRefType });

/** Validates `models.setDefault`'s output: set, or the model is unknown. */
export const ModelsSetDefaultOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("set") }),
    Type.Object({ kind: Type.Literal("unknown-model") }),
  ]),
);

/** Validates `models.verify`'s input. */
export const ModelsVerifyInputSchema = ON_PROVIDER;

/** Validates `models.verify`'s output: verified, unverified, or failed with a reason. */
export const ModelsVerifyOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("verified") }),
    Type.Object({ kind: Type.Literal("unverified") }),
    Type.Object({ kind: Type.Literal("failed"), reason: Type.String() }),
  ]),
);

/** Validates `models.login`'s input. */
export const ModelsLoginInputSchema = objectOf({ ...PROVIDER, method: LoginMethodType });

/** Validates `models.login`'s output: nothing; the attempt is `login.steps` for the provider. */
export const ModelsLoginOutputSchema = NOTHING;

/** Validates `models.logout`'s input. */
export const ModelsLogoutInputSchema = ON_PROVIDER;

/** Validates `models.logout`'s output: nothing. */
export const ModelsLogoutOutputSchema = NOTHING;

/** Validates `login.steps`'s input. */
export const LoginStepsInputSchema = ON_PROVIDER;

/** Validates one frame of `login.steps`'s output: a login step. */
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

/** Validates `login.answer`'s input. */
export const LoginAnswerInputSchema = objectOf({ ...PROVIDER, code: Type.String() });

/** Validates `login.answer`'s output: nothing. */
export const LoginAnswerOutputSchema = NOTHING;

/** Validates `settings.apply`'s input. */
export const SettingsApplyInputSchema = objectOf({ id: Type.String(), value: JsonType });

/** Validates `workspaces.list`'s input. */
export const WorkspacesListInputSchema = NO_INPUT;

/** Validates `workspaces.list`'s output: every registered workspace. */
export const WorkspacesListOutputSchema = WORKSPACES;

/** Validates `workspaces.inspect`'s input. */
export const WorkspacesInspectInputSchema = objectOf({ target: WorkspaceTargetType });

/** Validates `workspaces.add`'s input. */
export const WorkspacesAddInputSchema = objectOf({
  target: WorkspaceTargetType,
  options: Type.Optional(
    Type.Object({
      projectResources: Type.Optional(Type.Boolean()),
      expect: Type.Optional(Type.Object({ identity: idSchema<"environment-identity">() })),
    }),
  ),
});

/** Validates `workspaces.forget`'s input. */
export const WorkspacesForgetInputSchema = objectOf({ id: idSchema<"workspace">() });

/** Validates `sessions.watch`'s input. */
export const SessionsWatchInputSchema = objectOf({
  parents: Type.Optional(ParentFilterType),
  limit: Type.Optional(Type.Number()),
});

/** Validates one frame of `sessions.watch`'s output: the directory. */
export const SessionsWatchOutputSchema = SESSIONS;

/** Validates `sessions.create`'s input. */
export const SessionsCreateInputSchema = objectOf({
  id: Type.Optional(idSchema<"session">()),
  name: Type.Optional(Type.String()),
  workspace: Type.Optional(idSchema<"workspace">()),
  parent: Type.Optional(idSchema<"session">()),
  configuration: Type.Optional(Type.Union([ConfigurationType, ConfigurationPatchType])),
  prompt: Type.Optional(PromptOverrideType),
});

/** Validates `sessions.create`'s output: the new session's id. */
export const SessionsCreateOutputSchema = ON_SESSION;

/** Validates `sessions.list`'s input. */
export const SessionsListInputSchema = objectOf({
  parents: Type.Optional(ParentFilterType),
  cursor: Type.Optional(idSchema<"cursor">()),
  limit: Type.Optional(Type.Number()),
});

/** Validates `sessions.list`'s output: one page of the directory. */
export const SessionsListOutputSchema = pagedSchema(SessionInfoType);

/** Validates `session.info`'s input. */
export const SessionInfoInputSchema = ON_SESSION;

/** Validates `session.update`'s input. */
export const SessionUpdateInputSchema = objectOf({
  ...SESSION,
  patch: Type.Object({
    name: Type.Optional(nullable(Type.String())),
    pinned: Type.Optional(Type.Boolean()),
    archived: Type.Optional(Type.Boolean()),
    workspace: Type.Optional(idSchema<"workspace">()),
  }),
});

/** Validates `session.remove`'s input. */
export const SessionRemoveInputSchema = ON_SESSION;

/** Validates `session.stop`'s input. */
export const SessionStopInputSchema = ON_SESSION;

/** Validates `session.stop`'s output: the runs stopped and the messages withdrawn. */
export const SessionStopOutputSchema = objectOf({
  stopped: Type.Array(idSchema<"run">()),
  withdrawn: Type.Array(idSchema<"message">()),
});

/** Validates `session.command`'s input. */
export const SessionCommandInputSchema = objectOf({
  ...SESSION,
  name: Type.String(),
  args: Type.Optional(JsonType),
});

/** Validates `head.send`'s input. */
export const HeadSendInputSchema = objectOf({
  ...HEAD,
  content: UserContentType,
  options: Type.Optional(SendOptionsType),
});

/** Validates `head.send`'s output: the receipt and the message it admitted. */
export const HeadSendOutputSchema = objectOf({
  receipt: idSchema<"receipt">(),
  message: idSchema<"message">(),
});

/** Validates `head.configure`'s input. */
export const HeadConfigureInputSchema = objectOf({ ...HEAD, patch: ConfigurationPatchType });

/** Validates `head.view`'s input. */
export const HeadViewInputSchema = objectOf({ ...HEAD, options: Type.Optional(ViewOptionsType) });

/** Validates `head.watch`'s input: `after` is the seq to resume after, filled from `Last-Event-ID`. */
export const HeadWatchInputSchema = objectOf({
  ...HEAD,
  options: Type.Optional(ViewOptionsType),
  after: Type.Optional(SeqType),
});

/** Validates one frame of `head.watch`'s output: a session event or a patch, which the sdk folds, or the wire-only revision a head's ref holds (§40s). */
export const HeadWatchOutputSchema = schemaOf(
  Type.Union([
    SessionEventType,
    PatchEventType,
    Type.Object({
      kind: Type.Literal("revision"),
      head: idSchema<"head">(),
      revision: idSchema<"revision">(),
    }),
  ]),
);

/** Validates `head.history`'s input. */
export const HeadHistoryInputSchema = objectOf({
  ...HEAD,
  before: idSchema<"message">(),
  limit: Type.Number(),
});

/** Validates `head.history`'s output: older messages, newest last. */
export const HeadHistoryOutputSchema = schemaOf(Type.Array(MessageType));

/** Validates `head.tree`'s input. */
export const HeadTreeInputSchema = ON_HEAD;

/** Validates `head.move`'s input: `id` is the receipt id the sdk mints, so a replay finds the same move. */
export const HeadMoveInputSchema = objectOf({
  ...HEAD,
  position: PositionType,
  options: Type.Optional(MoveOptionsType),
  id: Type.Optional(idSchema<"receipt">()),
});

/** Validates `head.move`'s output: the move's receipt. */
export const HeadMoveOutputSchema = RECEIPT_ID;

/** Validates `head.compact`'s input. */
export const HeadCompactInputSchema = objectOf({
  ...HEAD,
  instructions: Type.Optional(Type.String()),
});

/** Validates `head.compact`'s output: started, busy, or nothing to compact. */
export const HeadCompactOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("started"), message: idSchema<"message">() }),
    Type.Object({ kind: Type.Literal("busy"), run: idSchema<"run">() }),
    Type.Object({ kind: Type.Literal("nothing-to-compact") }),
  ]),
);

/** Validates `heads.create`'s input. */
export const HeadsCreateInputSchema = objectOf({
  ...NAMED_HEAD,
  input: Type.Optional(Type.Object({ from: Type.Optional(PositionType) })),
});

/** Validates `heads.merge`'s input. */
export const HeadsMergeInputSchema = NAMED_HEAD_INPUT;

/** Validates `heads.remove`'s input. */
export const HeadsRemoveInputSchema = NAMED_HEAD_INPUT;

/** Validates `run.stop`'s input. */
export const RunStopInputSchema = ON_RUN;

/** Validates `run.stop`'s output: a stop outcome over the run's end. */
export const RunStopOutputSchema = stopOutcomeSchema(RunEndType);

/** Validates `run.settled`'s input. */
export const RunSettledInputSchema = ON_RUN;

/** Validates `receipt.status`'s input. */
export const ReceiptStatusInputSchema = ON_RECEIPT;

/** Validates `receipt.status`'s output: pending, settled with its outcome, or missing. */
export const ReceiptStatusOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("pending") }),
    Type.Object({ kind: Type.Literal("settled"), outcome: JsonType }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

/** Validates `receipt.settled`'s input. */
export const ReceiptSettledInputSchema = ON_RECEIPT;

/** Validates `receipt.stop`'s input. */
export const ReceiptStopInputSchema = ON_RECEIPT;

/** Validates `receipt.stop`'s output: a stop outcome over the command's outcome. */
export const ReceiptStopOutputSchema = stopOutcomeSchema(JsonType);

/** Validates `receipt.landed`'s input. */
export const ReceiptLandedInputSchema = ON_RECEIPT;

/** Validates `receipt.landed`'s output: landed, withdrawn, or the edit's move failure. */
export const ReceiptLandedOutputSchema = schemaOf(
  Type.Union([LANDED, Type.Object({ kind: Type.Literal("withdrawn") }), ...MOVE_FAILURES]),
);

/** Validates `parts.create`'s input: the definition's kind, which the host resolves, and the part's state and placement. */
export const PartsCreateInputSchema = objectOf({
  ...SESSION,
  kind: Type.String(),
  input: Type.Object({
    state: JsonType,
    placement: PlacementType,
    id: Type.Optional(idSchema<"part">()),
  }),
});

/** Validates `parts.create`'s output: the new part's id. */
export const PartsCreateOutputSchema = objectOf({ part: idSchema<"part">() });

/** Validates `part.update`'s input. */
export const PartUpdateInputSchema = objectOf({ ...PART, next: JsonType });

/** Validates `part.update`'s output: updated, invalid, closed or missing. */
export const PartUpdateOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("updated"), version: Type.Number() }),
    Type.Object({ kind: Type.Literal("invalid"), issues: Type.Array(ValidationIssueType) }),
    Type.Object({ kind: Type.Literal("closed") }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

/** Validates `part.act`'s input. */
export const PartActInputSchema = objectOf({ ...PART, action: Type.String(), input: JsonType });

/** Validates `part.act`'s output: an act outcome over the action's output. */
export const PartActOutputSchema = actOutcomeSchema(JsonType);

/** Validates `part.answer`'s input. */
export const PartAnswerInputSchema = ON_PART;

/** Validates `part.answer`'s output: the first action and its input, or null when dismissed. */
export const PartAnswerOutputSchema = schemaOf(
  nullable(Type.Object({ action: Type.String(), input: JsonType })),
);

/** Validates `part.close`'s input. */
export const PartCloseInputSchema = ON_PART;

/** Validates `part.close`'s output: nothing. */
export const PartCloseOutputSchema = NOTHING;

/** Validates `workspace.info`'s input. */
export const WorkspaceInfoInputSchema = ON_WORKSPACE;

/** Validates `workspace.watch`'s input. */
export const WorkspaceWatchInputSchema = ON_WORKSPACE;

/** Validates `workspace.update`'s input. */
export const WorkspaceUpdateInputSchema = objectOf({
  ...WORKSPACE,
  patch: Type.Object({ projectResources: Type.Optional(Type.Boolean()) }),
});

/** Validates `workspace.update`'s output: updated or missing. */
export const WorkspaceUpdateOutputSchema = WORKSPACE_CHANGE;

/** Validates `workspace.reload`'s input. */
export const WorkspaceReloadInputSchema = ON_WORKSPACE;

/** Validates `workspace.reload`'s output: updated or missing. */
export const WorkspaceReloadOutputSchema = WORKSPACE_CHANGE;

/** Validates `workspace.changes`'s input. */
export const WorkspaceChangesInputSchema = objectOf({ ...WORKSPACE, run: idSchema<"run">() });

/** Validates `workspace.patches`'s input. */
export const WorkspacePatchesInputSchema = objectOf({
  ...WORKSPACE,
  run: idSchema<"run">(),
  paths: Type.Array(Type.String()),
  options: Type.Optional(DiffOptionsType),
});

/** Validates `workspace.files`'s input. */
export const WorkspaceFilesInputSchema = ON_WORKSPACE;

/** Validates `workspace.git`'s input. */
export const WorkspaceGitInputSchema = ON_WORKSPACE;

/** Validates `workspace.browser`'s input. */
export const WorkspaceBrowserInputSchema = ON_WORKSPACE;

/** Validates `jobs.start`'s input. */
export const JobsStartInputSchema = objectOf({
  ...WORKSPACE,
  command: Type.Optional(Type.String()),
  session: Type.Optional(idSchema<"session">()),
  title: Type.Optional(Type.String()),
  pty: Type.Optional(Type.Object({ columns: Type.Number(), rows: Type.Number() })),
  id: Type.Optional(idSchema<"job">()),
});

/** Validates `jobs.start`'s output: the job's view and its recovery key. */
export const JobsStartOutputSchema = schemaOf(JOB_HANDLE);

/** Validates `jobs.recover`'s input. */
export const JobsRecoverInputSchema = objectOf({ ...WORKSPACE, key: idSchema<"job-key">() });

/** Validates `jobs.recover`'s output: the reclaimed job's view and key, ended, or missing. */
export const JobsRecoverOutputSchema = schemaOf(
  Type.Union([
    JOB_HANDLE,
    Type.Object({ kind: Type.Literal("ended"), end: JobEndType }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

/** Validates `jobs.list`'s input. */
export const JobsListInputSchema = ON_WORKSPACE;

/** Validates `jobs.list`'s output: every job in the workspace. */
export const JobsListOutputSchema = JOBS;

/** Validates `jobs.watch`'s input. */
export const JobsWatchInputSchema = ON_WORKSPACE;

/** Validates one frame of `jobs.watch`'s output: the job list. */
export const JobsWatchOutputSchema = JOBS;

/** Validates `job.write`'s input; the bytes are the request body. */
export const JobWriteInputSchema = ON_JOB;

/** Validates `job.write`'s output: nothing. */
export const JobWriteOutputSchema = NOTHING;

/** Validates `job.output`'s input. */
export const JobOutputInputSchema = ON_JOB;

/** Validates `job.resize`'s input. */
export const JobResizeInputSchema = objectOf({
  ...JOB,
  size: Type.Object({ columns: Type.Number(), rows: Type.Number() }),
});

/** Validates `job.resize`'s output: resized, not a pty, or missing. */
export const JobResizeOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("resized") }),
    Type.Object({ kind: Type.Literal("not-pty") }),
    Type.Object({ kind: Type.Literal("missing") }),
  ]),
);

/** Validates `job.idle`'s input. */
export const JobIdleInputSchema = ON_JOB;

/** Validates `job.idle`'s output: whether the shell is at a prompt. */
export const JobIdleOutputSchema = schemaOf(Type.Boolean());

/** Validates `job.stop`'s input. */
export const JobStopInputSchema = ON_JOB;

/** Validates `job.stop`'s output: a stop outcome over the job's end. */
export const JobStopOutputSchema = stopOutcomeSchema(JobEndType);

/** Validates `job.settled`'s input. */
export const JobSettledInputSchema = ON_JOB;

/** Validates `job.close`'s input. */
export const JobCloseInputSchema = ON_JOB;

/** Validates `job.close`'s output: nothing. */
export const JobCloseOutputSchema = NOTHING;

/** Validates `files.read`'s input. */
export const FilesReadInputSchema = ON_PATH;

/** Validates `files.bytes`'s input. */
export const FilesBytesInputSchema = ON_PATH;

/** Validates one frame of `files.bytes`'s output: bytes, base64 inside JSON, raw in an octet stream. */
export const FilesBytesOutputSchema = BYTES;

/** Validates `files.stat`'s input. */
export const FilesStatInputSchema = ON_PATH;

/** Validates `files.stat`'s output: kind, size and version, or null when nothing is there. */
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

/** Validates `files.write`'s input; the contents are the request body. */
export const FilesWriteInputSchema = objectOf({
  ...PATH,
  options: Type.Optional(
    Type.Object({
      expect: Type.Optional(Type.Union([Type.Literal("absent"), idSchema<"file-version">()])),
      parents: Type.Optional(Type.Boolean()),
    }),
  ),
});

/** Validates `files.remove`'s input. */
export const FilesRemoveInputSchema = objectOf({
  ...PATH,
  options: Type.Optional(Type.Object({ expect: Type.Optional(idSchema<"file-version">()) })),
});

/** Validates `files.batch`'s input: the plan's entries, each put carrying text or a stored blob's id, and the receipt id the sdk mints. */
export const FilesBatchInputSchema = objectOf({
  ...WORKSPACE,
  id: Type.Optional(idSchema<"receipt">()),
  entries: Type.Array(
    Type.Union([
      Type.Object({
        kind: Type.Literal("put"),
        path: Type.String(),
        contents: Type.String(),
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

/** Validates `files.batch`'s output: the batch's receipt. */
export const FilesBatchOutputSchema = RECEIPT_ID;

/** Validates `files.format`'s input. */
export const FilesFormatInputSchema = objectOf({ ...PATH, contents: Type.String() });

/** Validates `files.scan`'s input. */
export const FilesScanInputSchema = objectOf({
  ...WORKSPACE,
  directory: Type.Optional(Type.String()),
  ignored: Type.Optional(Type.Enum(["exclude", "include"])),
});

/** Validates `files.find`'s input. */
export const FilesFindInputSchema = QUERY_INPUT;

/** Validates `files.find`'s output: the name matches. */
export const FilesFindOutputSchema = schemaOf(Type.Array(FileEntryViewType));

/** Validates `files.search`'s input. */
export const FilesSearchInputSchema = QUERY_INPUT;

/** Validates `files.watch`'s input. */
export const FilesWatchInputSchema = objectOf({
  ...WORKSPACE,
  paths: Type.Optional(Type.Array(Type.String())),
});

/** Validates one frame of `files.watch`'s output: coalesced file events. */
export const FilesWatchOutputSchema = schemaOf(Type.Array(FileEventType));

/** Validates `files.upload`'s input; the bytes are the request body. */
export const FilesUploadInputSchema = ON_WORKSPACE;

/** Validates `git.status`'s input. */
export const GitStatusInputSchema = ON_WORKSPACE;

/** Validates `git.watch`'s input. */
export const GitWatchInputSchema = ON_WORKSPACE;

/** Validates `git.changes`'s input. */
export const GitChangesInputSchema = GIT_COMPARE_INPUT;

/** Validates `git.watchChanges`'s input. */
export const GitWatchChangesInputSchema = GIT_COMPARE_INPUT;

/** Validates `git.patches`'s input. */
export const GitPatchesInputSchema = objectOf({ ...GIT_COMPARE, paths: Type.Array(Type.String()) });

/** Validates `git.contents`'s input. */
export const GitContentsInputSchema = objectOf({ ...PATH, scope: GitScopeType });

/** Validates `git.log`'s input. */
export const GitLogInputSchema = objectOf({
  ...WORKSPACE,
  cursor: Type.Optional(idSchema<"cursor">()),
  limit: Type.Optional(Type.Number()),
});

/** Validates `git.log`'s output: one page of commit history. */
export const GitLogOutputSchema = pagedSchema(GitCommitViewType);

/** Validates `git.refs`'s input. */
export const GitRefsInputSchema = ON_WORKSPACE;

/** Validates `git.blame`'s input. */
export const GitBlameInputSchema = ON_PATH;

/** Validates `git.stage`'s input. */
export const GitStageInputSchema = GIT_PATHS_INPUT;

/** Validates `git.unstage`'s input. */
export const GitUnstageInputSchema = GIT_PATHS_INPUT;

/** Validates `git.discard`'s input. */
export const GitDiscardInputSchema = GIT_PATHS_INPUT;

/** Validates `git.commit`'s input. */
export const GitCommitInputSchema = objectOf({
  ...WORKSPACE,
  input: Type.Object({
    message: Type.String(),
    files: Type.Union([Type.Literal("staged"), Type.Literal("all"), Type.Array(Type.String())]),
  }),
  options: Type.Optional(GitWriteType),
});

/** Validates `git.branch`'s input. */
export const GitBranchInputSchema = objectOf({
  ...WORKSPACE,
  input: Type.Object({ name: Type.String(), checkout: Type.Boolean() }),
  options: Type.Optional(GitWriteType),
});

/** Validates `git.push`'s input. */
export const GitPushInputSchema = objectOf({
  ...WORKSPACE,
  input: Type.Optional(Type.Object({ setUpstream: Type.Optional(Type.Boolean()) })),
  options: Type.Optional(GitWriteType),
});

/** Validates `browser.open`'s input: `id` is the key the sdk mints, so a replay holds the same page. */
export const BrowserOpenInputSchema = objectOf({
  ...WORKSPACE,
  url: Type.String(),
  id: Type.Optional(Type.String()),
});

/** Validates `browser.adopt`'s input. */
export const BrowserAdoptInputSchema = objectOf({ ...WORKSPACE, id: idSchema<"page">() });

/** Validates `browser.list`'s input. */
export const BrowserListInputSchema = ON_WORKSPACE;

/** Validates `browser.list`'s output: every open page. */
export const BrowserListOutputSchema = PAGES;

/** Validates `browser.watch`'s input. */
export const BrowserWatchInputSchema = ON_WORKSPACE;

/** Validates one frame of `browser.watch`'s output: the page list. */
export const BrowserWatchOutputSchema = PAGES;

/** Validates `page.view`'s input. */
export const PageViewInputSchema = ON_PAGE;

/** Validates `page.watch`'s input. */
export const PageWatchInputSchema = ON_PAGE;

/** Validates `page.snapshot`'s input. */
export const PageSnapshotInputSchema = objectOf({ ...PAGE, ref: Type.Optional(Type.String()) });

/** Validates `page.navigate`'s input. */
export const PageNavigateInputSchema = objectOf({ ...PAGE, url: Type.String() });

/** Validates `page.back`'s input. */
export const PageBackInputSchema = ON_PAGE;

/** Validates `page.forward`'s input. */
export const PageForwardInputSchema = ON_PAGE;

/** Validates `page.reload`'s input. */
export const PageReloadInputSchema = ON_PAGE;

/** Validates `page.stopLoading`'s input. */
export const PageStopLoadingInputSchema = ON_PAGE;

/** Validates `page.click`'s input. */
export const PageClickInputSchema = objectOf({
  ...PAGE,
  ref: Type.String(),
  button: Type.Optional(Type.Enum(["left", "right", "middle"])),
  double: Type.Optional(Type.Boolean()),
  expect: Type.Optional(idSchema<"document-revision">()),
});

/** Validates `page.type`'s input. */
export const PageTypeInputSchema = objectOf({
  ...PAGE,
  ref: Type.String(),
  text: Type.String(),
  clear: Type.Optional(Type.Boolean()),
  submit: Type.Optional(Type.Boolean()),
  expect: Type.Optional(idSchema<"document-revision">()),
});

/** Validates `page.press`'s input. */
export const PagePressInputSchema = objectOf({
  ...PAGE,
  key: Type.String(),
  ref: Type.Optional(Type.String()),
});

/** Validates `page.scroll`'s input. */
export const PageScrollInputSchema = objectOf({
  ...PAGE,
  direction: Type.Enum(["up", "down", "top", "bottom"]),
  ref: Type.Optional(Type.String()),
  pages: Type.Optional(Type.Number()),
});

/** Validates `page.wait`'s input: the condition to wait for. */
export const PageWaitInputSchema = objectOf({
  ...PAGE,
  condition: Type.Union([
    Type.Object({ kind: Type.Literal("loaded") }),
    Type.Object({ kind: Type.Literal("text"), text: Type.String(), present: Type.Boolean() }),
    Type.Object({ kind: Type.Literal("delay"), ms: Type.Number() }),
  ]),
});

/** Validates `page.console`'s input. */
export const PageConsoleInputSchema = objectOf({
  ...PAGE,
  limit: Type.Optional(Type.Number()),
  clear: Type.Optional(Type.Boolean()),
});

/** Validates `page.console`'s output: console entries, newest first. */
export const PageConsoleOutputSchema = schemaOf(Type.Array(ConsoleEntryType));

/** Validates `page.capture`'s input. */
export const PageCaptureInputSchema = ON_PAGE;

/** Validates one frame of `page.capture`'s output: image bytes, base64 inside JSON, raw in an octet stream. */
export const PageCaptureOutputSchema = BYTES;

/** Validates `page.evaluate`'s input. */
export const PageEvaluateInputSchema = objectOf({
  ...PAGE,
  expression: Type.String(),
  options: Type.Optional(Type.Object({ ref: Type.Optional(Type.String()) })),
});

/** Validates `page.evaluate`'s output: the value, or what the expression threw. */
export const PageEvaluateOutputSchema = schemaOf(
  Type.Union([
    Type.Object({ kind: Type.Literal("value"), value: JsonType }),
    Type.Object({ kind: Type.Literal("threw"), message: Type.String() }),
  ]),
);

/** Validates `page.close`'s input. */
export const PageCloseInputSchema = ON_PAGE;

/** Validates `page.close`'s output: nothing. */
export const PageCloseOutputSchema = NOTHING;

/** Validates `plugins.replace`'s input: plugin files the host loads with its loader. */
export const PluginsReplaceInputSchema = objectOf({
  plugins: Type.Array(PLUGIN_FILE),
  scope: Type.Optional(Type.Object(SESSION)),
});

/** Validates `plugins.check`'s input: plugin files the host loads with its loader. */
export const PluginsCheckInputSchema = objectOf({ plugins: Type.Array(PLUGIN_FILE) });

/** Validates `principals.list`'s input. */
export const PrincipalsListInputSchema = NO_INPUT;

/** Validates `principals.list`'s output: every paired principal, authority as an array. */
export const PrincipalsListOutputSchema = schemaOf(Type.Array(PrincipalViewWireType));

/** Validates `principals.pair`'s input: the authority as an array. */
export const PrincipalsPairInputSchema = objectOf({
  authority: Type.Array(AuthorityType),
  label: Type.Optional(Type.String()),
});

/** Validates `principals.pair`'s output: the pairing code and when it expires. */
export const PrincipalsPairOutputSchema = objectOf({
  code: Type.String(),
  expiresAt: Type.Number(),
});

/** Validates `principals.revoke`'s input. */
export const PrincipalsRevokeInputSchema = objectOf({ id: idSchema<"principal">() });

/** Validates `principals.revoke`'s output: nothing. */
export const PrincipalsRevokeOutputSchema = NOTHING;
