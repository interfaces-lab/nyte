import {
  AddOutcomeSchema,
  BlameViewSchema,
  BlobIdSchema,
  BrowserAdoptInputSchema,
  BrowserListInputSchema,
  BrowserListOutputSchema,
  BrowserOpenInputSchema,
  BrowserWatchInputSchema,
  BrowserWatchOutputSchema,
  CapabilityWireSchema,
  ChangeSetSchema,
  CommandOutcomeSchema,
  ConfigureOutcomeSchema,
  ConnectionBlobInputSchema,
  ConnectionBlobOutputSchema,
  ConnectionWatchInputSchema,
  CreateHeadOutcomeSchema,
  FileDocumentSchema,
  FilesBatchInputSchema,
  FilesBatchOutputSchema,
  FilesBytesInputSchema,
  FilesBytesOutputSchema,
  FilesFindInputSchema,
  FilesFindOutputSchema,
  FilesFormatInputSchema,
  FilesReadInputSchema,
  FilesRemoveInputSchema,
  FilesScanInputSchema,
  FilesSearchInputSchema,
  FilesStatInputSchema,
  FilesStatOutputSchema,
  FilesUploadInputSchema,
  FilesWatchInputSchema,
  FilesWatchOutputSchema,
  FilesWriteInputSchema,
  ForgetOutcomeSchema,
  FormatOutcomeSchema,
  GitBlameInputSchema,
  GitBranchInputSchema,
  GitChangesInputSchema,
  GitCommitInputSchema,
  GitContentsInputSchema,
  GitDiscardInputSchema,
  GitFileSidesSchema,
  GitLogInputSchema,
  GitLogOutputSchema,
  GitOutcomeSchema,
  GitPatchesInputSchema,
  GitPushInputSchema,
  GitRefsInputSchema,
  GitRefsViewSchema,
  GitStageInputSchema,
  GitStatusInputSchema,
  GitStatusSchema,
  GitUnstageInputSchema,
  GitWatchChangesInputSchema,
  GitWatchInputSchema,
  HeadCompactInputSchema,
  HeadCompactOutputSchema,
  HeadConfigureInputSchema,
  HeadHistoryInputSchema,
  HeadHistoryOutputSchema,
  HeadMoveInputSchema,
  HeadMoveOutputSchema,
  HeadSendInputSchema,
  HeadSendOutputSchema,
  HeadTreeInputSchema,
  HeadViewInputSchema,
  HeadWatchInputSchema,
  HeadWatchOutputSchema,
  HeadsCreateInputSchema,
  HeadsMergeInputSchema,
  HeadsRemoveInputSchema,
  HostViewWireSchema,
  JobCloseInputSchema,
  JobCloseOutputSchema,
  JobEndSchema,
  JobIdleInputSchema,
  JobIdleOutputSchema,
  JobOutputInputSchema,
  JobResizeInputSchema,
  JobResizeOutputSchema,
  JobSettledInputSchema,
  JobStopInputSchema,
  JobStopOutputSchema,
  JobWriteInputSchema,
  JobWriteOutputSchema,
  JobsListInputSchema,
  JobsListOutputSchema,
  JobsRecoverInputSchema,
  JobsRecoverOutputSchema,
  JobsStartInputSchema,
  JobsStartOutputSchema,
  JobsWatchInputSchema,
  JobsWatchOutputSchema,
  JsonValueSchema,
  LoginAnswerInputSchema,
  LoginAnswerOutputSchema,
  LoginStepsInputSchema,
  LoginStepsOutputSchema,
  MergeOutcomeSchema,
  ModelCatalogViewSchema,
  ModelsListInputSchema,
  ModelsLoginInputSchema,
  ModelsLoginOutputSchema,
  ModelsLogoutInputSchema,
  ModelsLogoutOutputSchema,
  ModelsRefreshInputSchema,
  ModelsRefreshOutputSchema,
  ModelsSetDefaultInputSchema,
  ModelsSetDefaultOutputSchema,
  ModelsVerifyInputSchema,
  ModelsVerifyOutputSchema,
  OutputFrameSchema,
  PageBackInputSchema,
  PageCaptureInputSchema,
  PageCaptureOutputSchema,
  PageClickInputSchema,
  PageCloseInputSchema,
  PageCloseOutputSchema,
  PageConsoleInputSchema,
  PageConsoleOutputSchema,
  PageEvaluateInputSchema,
  PageEvaluateOutputSchema,
  PageForwardInputSchema,
  PageInfoSchema,
  PageNavigateInputSchema,
  PageOutcomeSchema,
  PagePressInputSchema,
  PageReloadInputSchema,
  PageScrollInputSchema,
  PageSnapshotInputSchema,
  PageSnapshotSchema,
  PageStopLoadingInputSchema,
  PageTypeInputSchema,
  PageViewInputSchema,
  PageViewSchema,
  PageWaitInputSchema,
  PageWatchInputSchema,
  PartActInputSchema,
  PartActOutputSchema,
  PartAnswerInputSchema,
  PartAnswerOutputSchema,
  PartCloseInputSchema,
  PartCloseOutputSchema,
  PartUpdateInputSchema,
  PartUpdateOutputSchema,
  PartsCreateInputSchema,
  PartsCreateOutputSchema,
  PatchSetWireSchema,
  PluginCheckReportSchema,
  PluginReplacementReportSchema,
  PluginsCheckInputSchema,
  PluginsReplaceInputSchema,
  PrincipalsListInputSchema,
  PrincipalsListOutputSchema,
  PrincipalsPairInputSchema,
  PrincipalsPairOutputSchema,
  PrincipalsRevokeInputSchema,
  PrincipalsRevokeOutputSchema,
  ReceiptLandedInputSchema,
  ReceiptLandedOutputSchema,
  ReceiptSettledInputSchema,
  ReceiptStatusInputSchema,
  ReceiptStatusOutputSchema,
  ReceiptStopInputSchema,
  ReceiptStopOutputSchema,
  RemoveHeadOutcomeSchema,
  RemoveSessionOutcomeSchema,
  RunEndSchema,
  RunSettledInputSchema,
  RunStopInputSchema,
  RunStopOutputSchema,
  ScanFrameSchema,
  SearchFrameSchema,
  SessionCommandInputSchema,
  SessionInfoInputSchema,
  SessionInfoSchema,
  SessionRemoveInputSchema,
  SessionStopInputSchema,
  SessionStopOutputSchema,
  SessionUpdateInputSchema,
  SessionViewSchema,
  SessionsCreateInputSchema,
  SessionsCreateOutputSchema,
  SessionsListInputSchema,
  SessionsListOutputSchema,
  SessionsWatchInputSchema,
  SessionsWatchOutputSchema,
  SettingOutcomeSchema,
  SettingsApplyInputSchema,
  TreeViewSchema,
  UpdateOutcomeSchema,
  WorkspaceBrowserInputSchema,
  WorkspaceChangesInputSchema,
  WorkspaceFilesInputSchema,
  WorkspaceGitInputSchema,
  WorkspaceInfoInputSchema,
  WorkspaceInfoSchema,
  WorkspaceInspectionSchema,
  WorkspacePatchesInputSchema,
  WorkspaceReloadInputSchema,
  WorkspaceReloadOutputSchema,
  WorkspaceUpdateInputSchema,
  WorkspaceUpdateOutputSchema,
  WorkspaceWatchInputSchema,
  WorkspacesAddInputSchema,
  WorkspacesForgetInputSchema,
  WorkspacesInspectInputSchema,
  WorkspacesListInputSchema,
  WorkspacesListOutputSchema,
  WriteOutcomeSchema,
} from "@nyte-ai/schema";
import type {
  ActOutcome,
  AddOutcome,
  Authority,
  BlameView,
  BlobId,
  CapabilityWire,
  ChangeSet,
  CommandOutcome,
  ConfigurationPatch,
  ConfigureOutcome,
  ConsoleEntry,
  CreateHeadOutcome,
  Declaration,
  DiffOptions,
  FileDocument,
  FileEntryView,
  FileEvent,
  ForgetOutcome,
  FormatOutcome,
  GitCommitView,
  GitFileSides,
  GitOutcome,
  GitRefsView,
  GitScope,
  GitStatus,
  GitWrite,
  HeadName,
  HostViewWire,
  Infer,
  JobEnd,
  JobId,
  JobKey,
  JobView,
  Json,
  MergeOutcome,
  Message,
  MessageId,
  ModelCatalogView,
  ModelRef,
  MoveOptions,
  OutputFrame,
  PageId,
  PageInfo,
  PageOutcome,
  PageSnapshot,
  PageView,
  Paged,
  PartId,
  PatchEvent,
  PatchSetWire,
  PluginCheckReport,
  PluginReplacementReport,
  Position,
  PrincipalId,
  PrincipalViewWire,
  ReceiptId,
  RemoveHeadOutcome,
  RemoveSessionOutcome,
  RunEnd,
  RunId,
  ScanFrame,
  SearchFrame,
  SendOptions,
  SessionEvent,
  SessionId,
  SessionInfo,
  SessionView,
  SettingOutcome,
  StopOutcome,
  TreeView,
  UpdateOutcome,
  UserContent,
  ViewOptions,
  WorkspaceId,
  WorkspaceInfo,
  WorkspaceInspection,
  WorkspaceTarget,
  WriteOutcome,
} from "@nyte-ai/schema";
import type {
  BrowserApi,
  FileBatch,
  FilesApi,
  GitApi,
  Head,
  Host,
  Job,
  Jobs,
  Login,
  ModelsApi,
  Page,
  Part,
  PartDefinition,
  Receipt,
  SendReceipt,
  Session,
  Sessions,
  Workspace,
  Workspaces,
} from "@nyte-ai/core";

/** The declaration table, keyed by Connection path: every served operation's wire schemas, kind, authority, scope, capability and recovery. */
export const declarations = {
  "connection.watch": {
    input: ConnectionWatchInputSchema,
    output: HostViewWireSchema,
    kind: "watch",
    authority: "participant",
    scope: "host",
  } satisfies Declaration<object, HostViewWire>,
  "connection.blob": {
    input: ConnectionBlobInputSchema,
    output: ConnectionBlobOutputSchema,
    kind: "stream",
    authority: "participant",
    scope: "host",
  } satisfies Declaration<{ readonly id: BlobId }, Uint8Array>,

  "models.list": {
    input: ModelsListInputSchema,
    output: ModelCatalogViewSchema,
    kind: "query",
    authority: "participant",
    scope: "host",
  } satisfies Declaration<object, ModelCatalogView>,
  "models.refresh": {
    input: ModelsRefreshInputSchema,
    output: ModelsRefreshOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<{ readonly provider?: string }, null>,
  "models.setDefault": {
    input: ModelsSetDefaultInputSchema,
    output: ModelsSetDefaultOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<{ readonly ref: ModelRef }, Awaited<ReturnType<ModelsApi["setDefault"]>>>,
  "models.verify": {
    input: ModelsVerifyInputSchema,
    output: ModelsVerifyOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<{ readonly provider: string }, Awaited<ReturnType<ModelsApi["verify"]>>>,
  "models.login": {
    input: ModelsLoginInputSchema,
    output: ModelsLoginOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<Parameters<ModelsApi["login"]>[0], null>,
  "models.logout": {
    input: ModelsLogoutInputSchema,
    output: ModelsLogoutOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<{ readonly provider: string }, null>,

  "login.steps": {
    input: LoginStepsInputSchema,
    output: LoginStepsOutputSchema,
    kind: "stream",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<
    { readonly provider: string },
    ReturnType<Login["steps"]> extends AsyncIterable<infer Step> ? Step : never
  >,
  "login.answer": {
    input: LoginAnswerInputSchema,
    output: LoginAnswerOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<{ readonly provider: string; readonly code: string }, null>,

  "settings.apply": {
    input: SettingsApplyInputSchema,
    output: SettingOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<{ readonly id: string; readonly value: Json }, SettingOutcome>,

  "workspaces.list": {
    input: WorkspacesListInputSchema,
    output: WorkspacesListOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "host",
  } satisfies Declaration<object, readonly WorkspaceInfo[]>,
  "workspaces.inspect": {
    input: WorkspacesInspectInputSchema,
    output: WorkspaceInspectionSchema,
    kind: "query",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<{ readonly target: WorkspaceTarget }, WorkspaceInspection>,
  "workspaces.add": {
    input: WorkspacesAddInputSchema,
    output: AddOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<
    { readonly target: WorkspaceTarget; readonly options?: Parameters<Workspaces["add"]>[1] },
    AddOutcome
  >,
  "workspaces.forget": {
    input: WorkspacesForgetInputSchema,
    output: ForgetOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  } satisfies Declaration<{ readonly id: WorkspaceId }, ForgetOutcome>,

  "sessions.watch": {
    input: SessionsWatchInputSchema,
    output: SessionsWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "host",
  } satisfies Declaration<NonNullable<Parameters<Sessions["watch"]>[0]>, readonly SessionInfo[]>,
  "sessions.create": {
    input: SessionsCreateInputSchema,
    output: SessionsCreateOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "host",
    recovery: "replay",
  } satisfies Declaration<
    NonNullable<Parameters<Sessions["create"]>[0]>,
    { readonly session: SessionId }
  >,
  "sessions.list": {
    input: SessionsListInputSchema,
    output: SessionsListOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "host",
  } satisfies Declaration<NonNullable<Parameters<Sessions["list"]>[0]>, Paged<SessionInfo>>,

  "session.info": {
    input: SessionInfoInputSchema,
    output: SessionInfoSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<{ readonly session: SessionId }, SessionInfo>,
  "session.update": {
    input: SessionUpdateInputSchema,
    output: UpdateOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly patch: Parameters<Session["update"]>[0] },
    UpdateOutcome
  >,
  "session.remove": {
    input: SessionRemoveInputSchema,
    output: RemoveSessionOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<{ readonly session: SessionId }, RemoveSessionOutcome>,
  "session.stop": {
    input: SessionStopInputSchema,
    output: SessionStopOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<{ readonly session: SessionId }, Awaited<ReturnType<Session["stop"]>>>,
  "session.command": {
    input: SessionCommandInputSchema,
    output: CommandOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly name: string; readonly args?: Json },
    CommandOutcome
  >,

  "head.send": {
    input: HeadSendInputSchema,
    output: HeadSendOutputSchema,
    kind: "receipt",
    authority: "participant",
    scope: "session",
    recovery: "replay",
  } satisfies Declaration<
    {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly content: UserContent;
      readonly options?: SendOptions;
    },
    { readonly receipt: ReceiptId; readonly message: MessageId }
  >,
  "head.configure": {
    input: HeadConfigureInputSchema,
    output: ConfigureOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly head: HeadName; readonly patch: ConfigurationPatch },
    ConfigureOutcome
  >,
  "head.view": {
    input: HeadViewInputSchema,
    output: SessionViewSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly head: HeadName; readonly options?: ViewOptions },
    SessionView
  >,
  "head.watch": {
    input: HeadWatchInputSchema,
    output: HeadWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly head: HeadName; readonly options?: ViewOptions },
    SessionEvent | PatchEvent
  >,
  "head.history": {
    input: HeadHistoryInputSchema,
    output: HeadHistoryOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly head: HeadName } & Parameters<Head["history"]>[0],
    readonly Message[]
  >,
  "head.tree": {
    input: HeadTreeInputSchema,
    output: TreeViewSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<{ readonly session: SessionId; readonly head: HeadName }, TreeView>,
  "head.move": {
    input: HeadMoveInputSchema,
    output: HeadMoveOutputSchema,
    kind: "receipt",
    authority: "participant",
    scope: "session",
    recovery: "replay",
  } satisfies Declaration<
    {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly position: Position;
      readonly options?: MoveOptions;
    },
    { readonly receipt: ReceiptId }
  >,
  "head.compact": {
    input: HeadCompactInputSchema,
    output: HeadCompactOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly head: HeadName } & NonNullable<
      Parameters<Head["compact"]>[0]
    >,
    Awaited<ReturnType<Head["compact"]>>
  >,

  "heads.create": {
    input: HeadsCreateInputSchema,
    output: CreateHeadOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    {
      readonly session: SessionId;
      readonly name: HeadName;
      readonly input?: Parameters<Session["heads"]["create"]>[1];
    },
    CreateHeadOutcome
  >,
  "heads.merge": {
    input: HeadsMergeInputSchema,
    output: MergeOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    {
      readonly session: SessionId;
      readonly name: HeadName;
      readonly options?: Parameters<Session["heads"]["merge"]>[1];
    },
    MergeOutcome
  >,
  "heads.remove": {
    input: HeadsRemoveInputSchema,
    output: RemoveHeadOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    {
      readonly session: SessionId;
      readonly name: HeadName;
      readonly options?: Parameters<Session["heads"]["remove"]>[1];
    },
    RemoveHeadOutcome
  >,

  "run.stop": {
    input: RunStopInputSchema,
    output: RunStopOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly run: RunId },
    StopOutcome<RunEnd>
  >,
  "run.settled": {
    input: RunSettledInputSchema,
    output: RunEndSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<{ readonly session: SessionId; readonly run: RunId }, RunEnd>,

  "receipt.status": {
    input: ReceiptStatusInputSchema,
    output: ReceiptStatusOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly receipt: ReceiptId },
    Awaited<ReturnType<Receipt<Json>["status"]>>
  >,
  "receipt.settled": {
    input: ReceiptSettledInputSchema,
    output: JsonValueSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<{ readonly session: SessionId; readonly receipt: ReceiptId }, Json>,
  "receipt.stop": {
    input: ReceiptStopInputSchema,
    output: ReceiptStopOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly receipt: ReceiptId },
    StopOutcome<Json>
  >,
  "receipt.landed": {
    input: ReceiptLandedInputSchema,
    output: ReceiptLandedOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly receipt: ReceiptId },
    Awaited<ReturnType<SendReceipt["landed"]>>
  >,

  "parts.create": {
    input: PartsCreateInputSchema,
    output: PartsCreateOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
    recovery: "replay",
  } satisfies Declaration<
    {
      readonly session: SessionId;
      readonly kind: PartDefinition["kind"];
      readonly input: Parameters<Session["parts"]["create"]>[1];
    },
    { readonly part: PartId }
  >,

  "part.update": {
    input: PartUpdateInputSchema,
    output: PartUpdateOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly part: PartId; readonly next: Json },
    Awaited<ReturnType<Part<PartDefinition>["update"]>>
  >,
  "part.act": {
    input: PartActInputSchema,
    output: PartActOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    {
      readonly session: SessionId;
      readonly part: PartId;
      readonly action: string;
      readonly input: Json;
    },
    ActOutcome<Json>
  >,
  "part.answer": {
    input: PartAnswerInputSchema,
    output: PartAnswerOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<
    { readonly session: SessionId; readonly part: PartId },
    Awaited<ReturnType<Part<PartDefinition>["answer"]>>
  >,
  "part.close": {
    input: PartCloseInputSchema,
    output: PartCloseOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  } satisfies Declaration<{ readonly session: SessionId; readonly part: PartId }, null>,

  "workspace.info": {
    input: WorkspaceInfoInputSchema,
    output: WorkspaceInfoSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, WorkspaceInfo>,
  "workspace.watch": {
    input: WorkspaceWatchInputSchema,
    output: WorkspaceInfoSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, WorkspaceInfo>,
  "workspace.update": {
    input: WorkspaceUpdateInputSchema,
    output: WorkspaceUpdateOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly patch: Parameters<Workspace["update"]>[0] },
    Awaited<ReturnType<Workspace["update"]>>
  >,
  "workspace.reload": {
    input: WorkspaceReloadInputSchema,
    output: WorkspaceReloadOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId },
    Awaited<ReturnType<Workspace["reload"]>>
  >,
  "workspace.changes": {
    input: WorkspaceChangesInputSchema,
    output: ChangeSetSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly run: RunId }, ChangeSet>,
  "workspace.patches": {
    input: WorkspacePatchesInputSchema,
    output: PatchSetWireSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly run: RunId;
      readonly paths: readonly string[];
      readonly options?: DiffOptions;
    },
    PatchSetWire
  >,
  "workspace.files": {
    input: WorkspaceFilesInputSchema,
    output: CapabilityWireSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, CapabilityWire>,
  "workspace.git": {
    input: WorkspaceGitInputSchema,
    output: CapabilityWireSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, CapabilityWire>,
  "workspace.browser": {
    input: WorkspaceBrowserInputSchema,
    output: CapabilityWireSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, CapabilityWire>,

  "jobs.start": {
    input: JobsStartInputSchema,
    output: JobsStartOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    recovery: "replay",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId } & Parameters<Jobs["start"]>[0],
    JobView & Pick<Job, "key">
  >,
  "jobs.recover": {
    input: JobsRecoverInputSchema,
    output: JobsRecoverOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly key: JobKey },
    (JobView & Pick<Job, "key">) | Exclude<Awaited<ReturnType<Jobs["recover"]>>, Job>
  >,
  "jobs.list": {
    input: JobsListInputSchema,
    output: JobsListOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, readonly JobView[]>,
  "jobs.watch": {
    input: JobsWatchInputSchema,
    output: JobsWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, readonly JobView[]>,

  "job.write": {
    input: JobWriteInputSchema,
    output: JobWriteOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    recovery: "never",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly job: JobId }, null>,
  "job.output": {
    input: JobOutputInputSchema,
    output: OutputFrameSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly job: JobId }, OutputFrame>,
  "job.resize": {
    input: JobResizeInputSchema,
    output: JobResizeOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly job: JobId;
      readonly size: Parameters<Job["resize"]>[0];
    },
    Awaited<ReturnType<Job["resize"]>>
  >,
  "job.idle": {
    input: JobIdleInputSchema,
    output: JobIdleOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly job: JobId }, boolean>,
  "job.stop": {
    input: JobStopInputSchema,
    output: JobStopOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly job: JobId },
    StopOutcome<JobEnd>
  >,
  "job.settled": {
    input: JobSettledInputSchema,
    output: JobEndSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly job: JobId }, JobEnd>,
  "job.close": {
    input: JobCloseInputSchema,
    output: JobCloseOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly job: JobId }, null>,

  "files.read": {
    input: FilesReadInputSchema,
    output: FileDocumentSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly path: string }, FileDocument>,
  "files.bytes": {
    input: FilesBytesInputSchema,
    output: FilesBytesOutputSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly path: string }, Uint8Array>,
  "files.stat": {
    input: FilesStatInputSchema,
    output: FilesStatOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly path: string },
    Awaited<ReturnType<FilesApi["stat"]>>
  >,
  "files.write": {
    input: FilesWriteInputSchema,
    output: WriteOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly path: string;
      readonly options?: Parameters<FilesApi["write"]>[2];
    },
    WriteOutcome
  >,
  "files.remove": {
    input: FilesRemoveInputSchema,
    output: WriteOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly path: string;
      readonly options?: Parameters<FilesApi["remove"]>[1];
    },
    WriteOutcome
  >,
  "files.batch": {
    input: FilesBatchInputSchema,
    output: FilesBatchOutputSchema,
    kind: "receipt",
    authority: "participant",
    scope: "workspace",
    capability: "files",
    recovery: "replay",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly entries: readonly (
        | ({ readonly kind: "put" } & Parameters<FileBatch["put"]>[0])
        | ({ readonly kind: "remove" } & Parameters<FileBatch["remove"]>[0])
      )[];
    },
    { readonly receipt: ReceiptId }
  >,
  "files.format": {
    input: FilesFormatInputSchema,
    output: FormatOutcomeSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly path: string; readonly contents: string },
    FormatOutcome
  >,
  "files.scan": {
    input: FilesScanInputSchema,
    output: ScanFrameSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId } & NonNullable<Parameters<FilesApi["scan"]>[0]>,
    ScanFrame
  >,
  "files.find": {
    input: FilesFindInputSchema,
    output: FilesFindOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId } & Parameters<FilesApi["find"]>[0],
    readonly FileEntryView[]
  >,
  "files.search": {
    input: FilesSearchInputSchema,
    output: SearchFrameSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId } & Parameters<FilesApi["search"]>[0],
    SearchFrame
  >,
  "files.watch": {
    input: FilesWatchInputSchema,
    output: FilesWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId } & NonNullable<Parameters<FilesApi["watch"]>[0]>,
    readonly FileEvent[]
  >,
  "files.upload": {
    input: FilesUploadInputSchema,
    output: BlobIdSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, BlobId>,

  "git.status": {
    input: GitStatusInputSchema,
    output: GitStatusSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, GitStatus>,
  "git.watch": {
    input: GitWatchInputSchema,
    output: GitStatusSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, GitStatus>,
  "git.changes": {
    input: GitChangesInputSchema,
    output: ChangeSetSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly scope: GitScope; readonly options?: DiffOptions },
    ChangeSet
  >,
  "git.watchChanges": {
    input: GitWatchChangesInputSchema,
    output: ChangeSetSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly scope: GitScope; readonly options?: DiffOptions },
    ChangeSet
  >,
  "git.patches": {
    input: GitPatchesInputSchema,
    output: PatchSetWireSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly scope: GitScope;
      readonly paths: readonly string[];
      readonly options?: DiffOptions;
    },
    PatchSetWire
  >,
  "git.contents": {
    input: GitContentsInputSchema,
    output: GitFileSidesSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly path: string; readonly scope: GitScope },
    GitFileSides
  >,
  "git.log": {
    input: GitLogInputSchema,
    output: GitLogOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId } & NonNullable<Parameters<GitApi["log"]>[0]>,
    Paged<GitCommitView>
  >,
  "git.refs": {
    input: GitRefsInputSchema,
    output: GitRefsViewSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, GitRefsView>,
  "git.blame": {
    input: GitBlameInputSchema,
    output: BlameViewSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly path: string }, BlameView>,
  "git.stage": {
    input: GitStageInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly paths: readonly string[];
      readonly options?: GitWrite;
    },
    GitOutcome
  >,
  "git.unstage": {
    input: GitUnstageInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly paths: readonly string[];
      readonly options?: GitWrite;
    },
    GitOutcome
  >,
  "git.discard": {
    input: GitDiscardInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly paths: readonly string[];
      readonly options?: GitWrite;
    },
    GitOutcome
  >,
  "git.commit": {
    input: GitCommitInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly input: Parameters<GitApi["commit"]>[0];
      readonly options?: GitWrite;
    },
    GitOutcome
  >,
  "git.branch": {
    input: GitBranchInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly input: Parameters<GitApi["branch"]>[0];
      readonly options?: GitWrite;
    },
    GitOutcome
  >,
  "git.push": {
    input: GitPushInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly input?: Parameters<GitApi["push"]>[0];
      readonly options?: GitWrite;
    },
    GitOutcome
  >,

  "browser.open": {
    input: BrowserOpenInputSchema,
    output: PageInfoSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "replay",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId } & Parameters<BrowserApi["open"]>[0],
    PageInfo
  >,
  "browser.adopt": {
    input: BrowserAdoptInputSchema,
    output: PageInfoSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly id: PageId }, PageInfo>,
  "browser.list": {
    input: BrowserListInputSchema,
    output: BrowserListOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, readonly PageInfo[]>,
  "browser.watch": {
    input: BrowserWatchInputSchema,
    output: BrowserWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId }, readonly PageInfo[]>,

  "page.view": {
    input: PageViewInputSchema,
    output: PageViewSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly page: PageId }, PageView>,
  "page.watch": {
    input: PageWatchInputSchema,
    output: PageViewSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly page: PageId }, PageView>,
  "page.snapshot": {
    input: PageSnapshotInputSchema,
    output: PageSnapshotSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly page: PageId } & NonNullable<
      Parameters<Page["snapshot"]>[0]
    >,
    PageSnapshot
  >,
  "page.navigate": {
    input: PageNavigateInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly page: PageId; readonly url: string },
    PageOutcome
  >,
  "page.back": {
    input: PageBackInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly page: PageId }, PageOutcome>,
  "page.forward": {
    input: PageForwardInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly page: PageId }, PageOutcome>,
  "page.reload": {
    input: PageReloadInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly page: PageId }, PageOutcome>,
  "page.stopLoading": {
    input: PageStopLoadingInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly page: PageId }, PageOutcome>,
  "page.click": {
    input: PageClickInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly page: PageId } & Parameters<Page["click"]>[0],
    PageOutcome
  >,
  "page.type": {
    input: PageTypeInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly page: PageId } & Parameters<Page["type"]>[0],
    PageOutcome
  >,
  "page.press": {
    input: PagePressInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly page: PageId } & Parameters<Page["press"]>[0],
    PageOutcome
  >,
  "page.scroll": {
    input: PageScrollInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly page: PageId } & Parameters<Page["scroll"]>[0],
    PageOutcome
  >,
  "page.wait": {
    input: PageWaitInputSchema,
    output: PageOutcomeSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly page: PageId;
      readonly condition: Parameters<Page["wait"]>[0];
    },
    PageOutcome
  >,
  "page.console": {
    input: PageConsoleInputSchema,
    output: PageConsoleOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<
    { readonly workspace: WorkspaceId; readonly page: PageId } & NonNullable<
      Parameters<Page["console"]>[0]
    >,
    readonly ConsoleEntry[]
  >,
  "page.capture": {
    input: PageCaptureInputSchema,
    output: PageCaptureOutputSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly page: PageId }, Uint8Array>,
  "page.evaluate": {
    input: PageEvaluateInputSchema,
    output: PageEvaluateOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  } satisfies Declaration<
    {
      readonly workspace: WorkspaceId;
      readonly page: PageId;
      readonly expression: string;
      readonly options?: Parameters<Page["evaluate"]>[1];
    },
    Awaited<ReturnType<Page["evaluate"]>>
  >,
  "page.close": {
    input: PageCloseInputSchema,
    output: PageCloseOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  } satisfies Declaration<{ readonly workspace: WorkspaceId; readonly page: PageId }, null>,

  "plugins.replace": {
    input: PluginsReplaceInputSchema,
    output: PluginReplacementReportSchema,
    kind: "command",
    authority: "maintenance",
    scope: "host",
  } satisfies Declaration<
    {
      readonly plugins: readonly Json[];
      readonly scope?: Parameters<Host["plugins"]["replace"]>[1];
    },
    PluginReplacementReport
  >,
  "plugins.check": {
    input: PluginsCheckInputSchema,
    output: PluginCheckReportSchema,
    kind: "query",
    authority: "maintenance",
    scope: "host",
  } satisfies Declaration<{ readonly plugins: readonly Json[] }, PluginCheckReport>,

  "principals.list": {
    input: PrincipalsListInputSchema,
    output: PrincipalsListOutputSchema,
    kind: "query",
    authority: "maintenance",
    scope: "host",
  } satisfies Declaration<object, readonly PrincipalViewWire[]>,
  "principals.pair": {
    input: PrincipalsPairInputSchema,
    output: PrincipalsPairOutputSchema,
    kind: "command",
    authority: "maintenance",
    scope: "host",
  } satisfies Declaration<
    { readonly authority: readonly Authority[]; readonly label?: string },
    Awaited<ReturnType<Host["principals"]["pair"]>>
  >,
  "principals.revoke": {
    input: PrincipalsRevokeInputSchema,
    output: PrincipalsRevokeOutputSchema,
    kind: "command",
    authority: "maintenance",
    scope: "host",
  } satisfies Declaration<{ readonly id: PrincipalId }, null>,
} satisfies { readonly [name: `${string}.${string}`]: Declaration<unknown, unknown> };

/** Returns the declaration table's type: each row's literal kind, authority and scope, and its schemas. */
export type Declarations = typeof declarations;

/** Names one served operation: a key of the table. */
export type OperationName = keyof Declarations;

/** Returns one operation's decoded input. */
export type OperationInput<N extends OperationName> = Infer<Declarations[N]["input"]>;

/** Returns one operation's decoded output: its value, or one frame of a `watch` or `stream` row. */
export type OperationOutput<N extends OperationName> = Infer<Declarations[N]["output"]>;
