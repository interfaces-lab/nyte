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
  Revision,
  RunEnd,
  RunId,
  ScanFrame,
  SearchFrame,
  SendOptions,
  Seq,
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

/** Returns each operation's input and output as core's signatures type them: the table's schemas are checked against them both ways (§40r). */
export type Signatures = {
  "connection.watch": { readonly input: object; readonly output: HostViewWire };
  "connection.blob": { readonly input: { readonly id: BlobId }; readonly output: Uint8Array };
  "models.list": { readonly input: object; readonly output: ModelCatalogView };
  "models.refresh": { readonly input: { readonly provider?: string }; readonly output: null };
  "models.setDefault": {
    readonly input: { readonly ref: ModelRef };
    readonly output: Awaited<ReturnType<ModelsApi["setDefault"]>>;
  };
  "models.verify": {
    readonly input: { readonly provider: string };
    readonly output: Awaited<ReturnType<ModelsApi["verify"]>>;
  };
  "models.login": { readonly input: Parameters<ModelsApi["login"]>[0]; readonly output: null };
  "models.logout": { readonly input: { readonly provider: string }; readonly output: null };
  "login.steps": {
    readonly input: { readonly provider: string };
    readonly output: ReturnType<Login["steps"]> extends AsyncIterable<infer Step> ? Step : never;
  };
  "login.answer": {
    readonly input: { readonly provider: string; readonly code: string };
    readonly output: null;
  };
  "settings.apply": {
    readonly input: { readonly id: string; readonly value: Json };
    readonly output: SettingOutcome;
  };
  "workspaces.list": { readonly input: object; readonly output: readonly WorkspaceInfo[] };
  "workspaces.inspect": {
    readonly input: { readonly target: WorkspaceTarget };
    readonly output: WorkspaceInspection;
  };
  "workspaces.add": {
    readonly input: {
      readonly target: WorkspaceTarget;
      readonly options?: Parameters<Workspaces["add"]>[1];
    };
    readonly output: AddOutcome;
  };
  "workspaces.forget": {
    readonly input: { readonly id: WorkspaceId };
    readonly output: ForgetOutcome;
  };
  "sessions.watch": {
    readonly input: NonNullable<Parameters<Sessions["watch"]>[0]>;
    readonly output: readonly SessionInfo[];
  };
  "sessions.create": {
    readonly input: NonNullable<Parameters<Sessions["create"]>[0]>;
    readonly output: { readonly session: SessionId };
  };
  "sessions.list": {
    readonly input: NonNullable<Parameters<Sessions["list"]>[0]>;
    readonly output: Paged<SessionInfo>;
  };
  "session.info": { readonly input: { readonly session: SessionId }; readonly output: SessionInfo };
  "session.update": {
    readonly input: {
      readonly session: SessionId;
      readonly patch: Parameters<Session["update"]>[0];
    };
    readonly output: UpdateOutcome;
  };
  "session.remove": {
    readonly input: { readonly session: SessionId };
    readonly output: RemoveSessionOutcome;
  };
  "session.stop": {
    readonly input: { readonly session: SessionId };
    readonly output: Awaited<ReturnType<Session["stop"]>>;
  };
  "session.command": {
    readonly input: { readonly session: SessionId; readonly name: string; readonly args?: Json };
    readonly output: CommandOutcome;
  };
  "head.send": {
    readonly input: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly content: UserContent;
      readonly options?: SendOptions;
    };
    readonly output: { readonly receipt: ReceiptId; readonly message: MessageId };
  };
  "head.configure": {
    readonly input: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly patch: ConfigurationPatch;
    };
    readonly output: ConfigureOutcome;
  };
  "head.view": {
    readonly input: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly options?: ViewOptions;
    };
    readonly output: SessionView;
  };
  "head.watch": {
    readonly input: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly options?: ViewOptions;
      readonly after?: Seq;
    };
    readonly output:
      | SessionEvent
      | PatchEvent
      | { readonly kind: "revision"; readonly head: HeadName; readonly revision: Revision };
  };
  "head.history": {
    readonly input: { readonly session: SessionId; readonly head: HeadName } & Parameters<
      Head["history"]
    >[0];
    readonly output: readonly Message[];
  };
  "head.tree": {
    readonly input: { readonly session: SessionId; readonly head: HeadName };
    readonly output: TreeView;
  };
  "head.move": {
    readonly input: {
      readonly session: SessionId;
      readonly head: HeadName;
      readonly position: Position;
      readonly options?: MoveOptions;
      readonly id?: ReceiptId;
    };
    readonly output: { readonly receipt: ReceiptId };
  };
  "head.compact": {
    readonly input: { readonly session: SessionId; readonly head: HeadName } & NonNullable<
      Parameters<Head["compact"]>[0]
    >;
    readonly output: Awaited<ReturnType<Head["compact"]>>;
  };
  "heads.create": {
    readonly input: {
      readonly session: SessionId;
      readonly name: HeadName;
      readonly input?: Parameters<Session["heads"]["create"]>[1];
    };
    readonly output: CreateHeadOutcome;
  };
  "heads.merge": {
    readonly input: {
      readonly session: SessionId;
      readonly name: HeadName;
      readonly options?: Parameters<Session["heads"]["merge"]>[1];
    };
    readonly output: MergeOutcome;
  };
  "heads.remove": {
    readonly input: {
      readonly session: SessionId;
      readonly name: HeadName;
      readonly options?: Parameters<Session["heads"]["remove"]>[1];
    };
    readonly output: RemoveHeadOutcome;
  };
  "run.stop": {
    readonly input: { readonly session: SessionId; readonly run: RunId };
    readonly output: StopOutcome<RunEnd>;
  };
  "run.settled": {
    readonly input: { readonly session: SessionId; readonly run: RunId };
    readonly output: RunEnd;
  };
  "receipt.status": {
    readonly input: { readonly session: SessionId | null; readonly receipt: ReceiptId };
    readonly output: Awaited<ReturnType<Receipt<Json>["status"]>>;
  };
  "receipt.settled": {
    readonly input: { readonly session: SessionId | null; readonly receipt: ReceiptId };
    readonly output: Json;
  };
  "receipt.stop": {
    readonly input: { readonly session: SessionId | null; readonly receipt: ReceiptId };
    readonly output: StopOutcome<Json>;
  };
  "receipt.landed": {
    readonly input: { readonly session: SessionId | null; readonly receipt: ReceiptId };
    readonly output: Awaited<ReturnType<SendReceipt["landed"]>>;
  };
  "parts.create": {
    readonly input: {
      readonly session: SessionId;
      readonly kind: PartDefinition["kind"];
      readonly input: Omit<Parameters<Session["parts"]["create"]>[1], "state"> & {
        readonly state: Json;
      };
    };
    readonly output: { readonly part: PartId };
  };
  "part.update": {
    readonly input: { readonly session: SessionId; readonly part: PartId; readonly next: Json };
    readonly output: Awaited<ReturnType<Part<PartDefinition>["update"]>>;
  };
  "part.act": {
    readonly input: {
      readonly session: SessionId;
      readonly part: PartId;
      readonly action: string;
      readonly input: Json;
    };
    readonly output: ActOutcome<Json>;
  };
  "part.answer": {
    readonly input: { readonly session: SessionId; readonly part: PartId };
    readonly output: { readonly action: string; readonly input: Json } | null;
  };
  "part.close": {
    readonly input: { readonly session: SessionId; readonly part: PartId };
    readonly output: null;
  };
  "workspace.info": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: WorkspaceInfo;
  };
  "workspace.watch": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: WorkspaceInfo;
  };
  "workspace.update": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly patch: Parameters<Workspace["update"]>[0];
    };
    readonly output: Awaited<ReturnType<Workspace["update"]>>;
  };
  "workspace.reload": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: Awaited<ReturnType<Workspace["reload"]>>;
  };
  "workspace.changes": {
    readonly input: { readonly workspace: WorkspaceId; readonly run: RunId };
    readonly output: ChangeSet;
  };
  "workspace.patches": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly run: RunId;
      readonly paths: readonly string[];
      readonly options?: DiffOptions;
    };
    readonly output: PatchSetWire;
  };
  "workspace.files": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: CapabilityWire;
  };
  "workspace.git": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: CapabilityWire;
  };
  "workspace.browser": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: CapabilityWire;
  };
  "jobs.start": {
    readonly input: { readonly workspace: WorkspaceId } & Parameters<Jobs["start"]>[0];
    readonly output: JobView & Pick<Job, "key">;
  };
  "jobs.recover": {
    readonly input: { readonly workspace: WorkspaceId; readonly key: JobKey };
    readonly output:
      | (JobView & Pick<Job, "key">)
      | Exclude<Awaited<ReturnType<Jobs["recover"]>>, Job>;
  };
  "jobs.list": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: readonly JobView[];
  };
  "jobs.watch": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: readonly JobView[];
  };
  "job.write": {
    readonly input: { readonly workspace: WorkspaceId; readonly job: JobId };
    readonly output: null;
  };
  "job.output": {
    readonly input: { readonly workspace: WorkspaceId; readonly job: JobId };
    readonly output: OutputFrame;
  };
  "job.resize": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly job: JobId;
      readonly size: Parameters<Job["resize"]>[0];
    };
    readonly output: Awaited<ReturnType<Job["resize"]>>;
  };
  "job.idle": {
    readonly input: { readonly workspace: WorkspaceId; readonly job: JobId };
    readonly output: boolean;
  };
  "job.stop": {
    readonly input: { readonly workspace: WorkspaceId; readonly job: JobId };
    readonly output: StopOutcome<JobEnd>;
  };
  "job.settled": {
    readonly input: { readonly workspace: WorkspaceId; readonly job: JobId };
    readonly output: JobEnd;
  };
  "job.close": {
    readonly input: { readonly workspace: WorkspaceId; readonly job: JobId };
    readonly output: null;
  };
  "files.read": {
    readonly input: { readonly workspace: WorkspaceId; readonly path: string };
    readonly output: FileDocument;
  };
  "files.bytes": {
    readonly input: { readonly workspace: WorkspaceId; readonly path: string };
    readonly output: Uint8Array;
  };
  "files.stat": {
    readonly input: { readonly workspace: WorkspaceId; readonly path: string };
    readonly output: Awaited<ReturnType<FilesApi["stat"]>>;
  };
  "files.write": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly path: string;
      readonly options?: Parameters<FilesApi["write"]>[2];
    };
    readonly output: WriteOutcome;
  };
  "files.remove": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly path: string;
      readonly options?: Parameters<FilesApi["remove"]>[1];
    };
    readonly output: WriteOutcome;
  };
  "files.batch": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly id?: ReceiptId;
      readonly entries: readonly (
        | ({ readonly kind: "put"; readonly contents: string | BlobId } & Omit<
            Parameters<FileBatch["put"]>[0],
            "contents"
          >)
        | ({ readonly kind: "remove" } & Parameters<FileBatch["remove"]>[0])
      )[];
    };
    readonly output: { readonly receipt: ReceiptId };
  };
  "files.format": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly path: string;
      readonly contents: string;
    };
    readonly output: FormatOutcome;
  };
  "files.scan": {
    readonly input: { readonly workspace: WorkspaceId } & NonNullable<
      Parameters<FilesApi["scan"]>[0]
    >;
    readonly output: ScanFrame;
  };
  "files.find": {
    readonly input: { readonly workspace: WorkspaceId } & Parameters<FilesApi["find"]>[0];
    readonly output: readonly FileEntryView[];
  };
  "files.search": {
    readonly input: { readonly workspace: WorkspaceId } & Parameters<FilesApi["search"]>[0];
    readonly output: SearchFrame;
  };
  "files.watch": {
    readonly input: { readonly workspace: WorkspaceId } & NonNullable<
      Parameters<FilesApi["watch"]>[0]
    >;
    readonly output: readonly FileEvent[];
  };
  "files.upload": { readonly input: { readonly workspace: WorkspaceId }; readonly output: BlobId };
  "git.status": { readonly input: { readonly workspace: WorkspaceId }; readonly output: GitStatus };
  "git.watch": { readonly input: { readonly workspace: WorkspaceId }; readonly output: GitStatus };
  "git.changes": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly scope: GitScope;
      readonly options?: DiffOptions;
    };
    readonly output: ChangeSet;
  };
  "git.watchChanges": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly scope: GitScope;
      readonly options?: DiffOptions;
    };
    readonly output: ChangeSet;
  };
  "git.patches": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly scope: GitScope;
      readonly paths: readonly string[];
      readonly options?: DiffOptions;
    };
    readonly output: PatchSetWire;
  };
  "git.contents": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly path: string;
      readonly scope: GitScope;
    };
    readonly output: GitFileSides;
  };
  "git.log": {
    readonly input: { readonly workspace: WorkspaceId } & NonNullable<Parameters<GitApi["log"]>[0]>;
    readonly output: Paged<GitCommitView>;
  };
  "git.refs": { readonly input: { readonly workspace: WorkspaceId }; readonly output: GitRefsView };
  "git.blame": {
    readonly input: { readonly workspace: WorkspaceId; readonly path: string };
    readonly output: BlameView;
  };
  "git.stage": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly paths: readonly string[];
      readonly options?: GitWrite;
    };
    readonly output: GitOutcome;
  };
  "git.unstage": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly paths: readonly string[];
      readonly options?: GitWrite;
    };
    readonly output: GitOutcome;
  };
  "git.discard": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly paths: readonly string[];
      readonly options?: GitWrite;
    };
    readonly output: GitOutcome;
  };
  "git.commit": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly input: Parameters<GitApi["commit"]>[0];
      readonly options?: GitWrite;
    };
    readonly output: GitOutcome;
  };
  "git.branch": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly input: Parameters<GitApi["branch"]>[0];
      readonly options?: GitWrite;
    };
    readonly output: GitOutcome;
  };
  "git.push": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly input?: Parameters<GitApi["push"]>[0];
      readonly options?: GitWrite;
    };
    readonly output: GitOutcome;
  };
  "browser.open": {
    readonly input: { readonly workspace: WorkspaceId; readonly id?: string } & Parameters<
      BrowserApi["open"]
    >[0];
    readonly output: PageInfo;
  };
  "browser.adopt": {
    readonly input: { readonly workspace: WorkspaceId; readonly id: PageId };
    readonly output: PageInfo;
  };
  "browser.list": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: readonly PageInfo[];
  };
  "browser.watch": {
    readonly input: { readonly workspace: WorkspaceId };
    readonly output: readonly PageInfo[];
  };
  "page.view": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId };
    readonly output: PageView;
  };
  "page.watch": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId };
    readonly output: PageView;
  };
  "page.snapshot": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId } & NonNullable<
      Parameters<Page["snapshot"]>[0]
    >;
    readonly output: PageSnapshot;
  };
  "page.navigate": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly page: PageId;
      readonly url: string;
    };
    readonly output: PageOutcome;
  };
  "page.back": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId };
    readonly output: PageOutcome;
  };
  "page.forward": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId };
    readonly output: PageOutcome;
  };
  "page.reload": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId };
    readonly output: PageOutcome;
  };
  "page.stopLoading": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId };
    readonly output: PageOutcome;
  };
  "page.click": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId } & Parameters<
      Page["click"]
    >[0];
    readonly output: PageOutcome;
  };
  "page.type": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId } & Parameters<
      Page["type"]
    >[0];
    readonly output: PageOutcome;
  };
  "page.press": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId } & Parameters<
      Page["press"]
    >[0];
    readonly output: PageOutcome;
  };
  "page.scroll": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId } & Parameters<
      Page["scroll"]
    >[0];
    readonly output: PageOutcome;
  };
  "page.wait": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly page: PageId;
      readonly condition: Parameters<Page["wait"]>[0];
    };
    readonly output: PageOutcome;
  };
  "page.console": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId } & NonNullable<
      Parameters<Page["console"]>[0]
    >;
    readonly output: readonly ConsoleEntry[];
  };
  "page.capture": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId };
    readonly output: Uint8Array;
  };
  "page.evaluate": {
    readonly input: {
      readonly workspace: WorkspaceId;
      readonly page: PageId;
      readonly expression: string;
      readonly options?: Parameters<Page["evaluate"]>[1];
    };
    readonly output: Awaited<ReturnType<Page["evaluate"]>>;
  };
  "page.close": {
    readonly input: { readonly workspace: WorkspaceId; readonly page: PageId };
    readonly output: null;
  };
  "plugins.replace": {
    readonly input: {
      readonly plugins: readonly { readonly path: string }[];
      readonly scope?: Parameters<Host["plugins"]["replace"]>[1];
    };
    readonly output: PluginReplacementReport;
  };
  "plugins.check": {
    readonly input: { readonly plugins: readonly { readonly path: string }[] };
    readonly output: PluginCheckReport;
  };
  "principals.list": { readonly input: object; readonly output: readonly PrincipalViewWire[] };
  "principals.pair": {
    readonly input: { readonly authority: readonly Authority[]; readonly label?: string };
    readonly output: Awaited<ReturnType<Host["principals"]["pair"]>>;
  };
  "principals.revoke": { readonly input: { readonly id: PrincipalId }; readonly output: null };
};

/** The declaration table, keyed by Connection path: every served operation's wire schemas, kind, authority, scope, capability and recovery. */
export const declarations = {
  "connection.watch": {
    input: ConnectionWatchInputSchema,
    output: HostViewWireSchema,
    kind: "watch",
    authority: "participant",
    scope: "host",
  },
  "connection.blob": {
    input: ConnectionBlobInputSchema,
    output: ConnectionBlobOutputSchema,
    kind: "stream",
    authority: "participant",
    scope: "host",
  },

  "models.list": {
    input: ModelsListInputSchema,
    output: ModelCatalogViewSchema,
    kind: "query",
    authority: "participant",
    scope: "host",
  },
  "models.refresh": {
    input: ModelsRefreshInputSchema,
    output: ModelsRefreshOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },
  "models.setDefault": {
    input: ModelsSetDefaultInputSchema,
    output: ModelsSetDefaultOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },
  "models.verify": {
    input: ModelsVerifyInputSchema,
    output: ModelsVerifyOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },
  "models.login": {
    input: ModelsLoginInputSchema,
    output: ModelsLoginOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },
  "models.logout": {
    input: ModelsLogoutInputSchema,
    output: ModelsLogoutOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },

  "login.steps": {
    input: LoginStepsInputSchema,
    output: LoginStepsOutputSchema,
    kind: "stream",
    authority: "owner",
    scope: "host",
  },
  "login.answer": {
    input: LoginAnswerInputSchema,
    output: LoginAnswerOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },

  "settings.apply": {
    input: SettingsApplyInputSchema,
    output: SettingOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },

  "workspaces.list": {
    input: WorkspacesListInputSchema,
    output: WorkspacesListOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "host",
  },
  "workspaces.inspect": {
    input: WorkspacesInspectInputSchema,
    output: WorkspaceInspectionSchema,
    kind: "query",
    authority: "owner",
    scope: "host",
  },
  "workspaces.add": {
    input: WorkspacesAddInputSchema,
    output: AddOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },
  "workspaces.forget": {
    input: WorkspacesForgetInputSchema,
    output: ForgetOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "host",
  },

  "sessions.watch": {
    input: SessionsWatchInputSchema,
    output: SessionsWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "host",
  },
  "sessions.create": {
    input: SessionsCreateInputSchema,
    output: SessionsCreateOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "host",
    recovery: "replay",
  },
  "sessions.list": {
    input: SessionsListInputSchema,
    output: SessionsListOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "host",
  },

  "session.info": {
    input: SessionInfoInputSchema,
    output: SessionInfoSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },
  "session.update": {
    input: SessionUpdateInputSchema,
    output: UpdateOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "session.remove": {
    input: SessionRemoveInputSchema,
    output: RemoveSessionOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "session.stop": {
    input: SessionStopInputSchema,
    output: SessionStopOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "session.command": {
    input: SessionCommandInputSchema,
    output: CommandOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },

  "head.send": {
    input: HeadSendInputSchema,
    output: HeadSendOutputSchema,
    kind: "receipt",
    authority: "participant",
    scope: "session",
    recovery: "replay",
  },
  "head.configure": {
    input: HeadConfigureInputSchema,
    output: ConfigureOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "head.view": {
    input: HeadViewInputSchema,
    output: SessionViewSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },
  "head.watch": {
    input: HeadWatchInputSchema,
    output: HeadWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "session",
  },
  "head.history": {
    input: HeadHistoryInputSchema,
    output: HeadHistoryOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },
  "head.tree": {
    input: HeadTreeInputSchema,
    output: TreeViewSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },
  "head.move": {
    input: HeadMoveInputSchema,
    output: HeadMoveOutputSchema,
    kind: "receipt",
    authority: "participant",
    scope: "session",
    recovery: "replay",
  },
  "head.compact": {
    input: HeadCompactInputSchema,
    output: HeadCompactOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },

  "heads.create": {
    input: HeadsCreateInputSchema,
    output: CreateHeadOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "heads.merge": {
    input: HeadsMergeInputSchema,
    output: MergeOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "heads.remove": {
    input: HeadsRemoveInputSchema,
    output: RemoveHeadOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },

  "run.stop": {
    input: RunStopInputSchema,
    output: RunStopOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "run.settled": {
    input: RunSettledInputSchema,
    output: RunEndSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },

  "receipt.status": {
    input: ReceiptStatusInputSchema,
    output: ReceiptStatusOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },
  "receipt.settled": {
    input: ReceiptSettledInputSchema,
    output: JsonValueSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },
  "receipt.stop": {
    input: ReceiptStopInputSchema,
    output: ReceiptStopOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "receipt.landed": {
    input: ReceiptLandedInputSchema,
    output: ReceiptLandedOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },

  "parts.create": {
    input: PartsCreateInputSchema,
    output: PartsCreateOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
    recovery: "replay",
  },

  "part.update": {
    input: PartUpdateInputSchema,
    output: PartUpdateOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "part.act": {
    input: PartActInputSchema,
    output: PartActOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },
  "part.answer": {
    input: PartAnswerInputSchema,
    output: PartAnswerOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "session",
  },
  "part.close": {
    input: PartCloseInputSchema,
    output: PartCloseOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "session",
  },

  "workspace.info": {
    input: WorkspaceInfoInputSchema,
    output: WorkspaceInfoSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  },
  "workspace.watch": {
    input: WorkspaceWatchInputSchema,
    output: WorkspaceInfoSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
  },
  "workspace.update": {
    input: WorkspaceUpdateInputSchema,
    output: WorkspaceUpdateOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
  },
  "workspace.reload": {
    input: WorkspaceReloadInputSchema,
    output: WorkspaceReloadOutputSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
  },
  "workspace.changes": {
    input: WorkspaceChangesInputSchema,
    output: ChangeSetSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  },
  "workspace.patches": {
    input: WorkspacePatchesInputSchema,
    output: PatchSetWireSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
  },
  "workspace.files": {
    input: WorkspaceFilesInputSchema,
    output: CapabilityWireSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  },
  "workspace.git": {
    input: WorkspaceGitInputSchema,
    output: CapabilityWireSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  },
  "workspace.browser": {
    input: WorkspaceBrowserInputSchema,
    output: CapabilityWireSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  },

  "jobs.start": {
    input: JobsStartInputSchema,
    output: JobsStartOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    recovery: "replay",
  },
  "jobs.recover": {
    input: JobsRecoverInputSchema,
    output: JobsRecoverOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
  },
  "jobs.list": {
    input: JobsListInputSchema,
    output: JobsListOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  },
  "jobs.watch": {
    input: JobsWatchInputSchema,
    output: JobsWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
  },

  "job.write": {
    input: JobWriteInputSchema,
    output: JobWriteOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    recovery: "never",
  },
  "job.output": {
    input: JobOutputInputSchema,
    output: OutputFrameSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
  },
  "job.resize": {
    input: JobResizeInputSchema,
    output: JobResizeOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
  },
  "job.idle": {
    input: JobIdleInputSchema,
    output: JobIdleOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  },
  "job.stop": {
    input: JobStopInputSchema,
    output: JobStopOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
  },
  "job.settled": {
    input: JobSettledInputSchema,
    output: JobEndSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
  },
  "job.close": {
    input: JobCloseInputSchema,
    output: JobCloseOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
  },

  "files.read": {
    input: FilesReadInputSchema,
    output: FileDocumentSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.bytes": {
    input: FilesBytesInputSchema,
    output: FilesBytesOutputSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.stat": {
    input: FilesStatInputSchema,
    output: FilesStatOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.write": {
    input: FilesWriteInputSchema,
    output: WriteOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.remove": {
    input: FilesRemoveInputSchema,
    output: WriteOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.batch": {
    input: FilesBatchInputSchema,
    output: FilesBatchOutputSchema,
    kind: "receipt",
    authority: "participant",
    scope: "workspace",
    capability: "files",
    recovery: "replay",
  },
  "files.format": {
    input: FilesFormatInputSchema,
    output: FormatOutcomeSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.scan": {
    input: FilesScanInputSchema,
    output: ScanFrameSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.find": {
    input: FilesFindInputSchema,
    output: FilesFindOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.search": {
    input: FilesSearchInputSchema,
    output: SearchFrameSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.watch": {
    input: FilesWatchInputSchema,
    output: FilesWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },
  "files.upload": {
    input: FilesUploadInputSchema,
    output: BlobIdSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "files",
  },

  "git.status": {
    input: GitStatusInputSchema,
    output: GitStatusSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.watch": {
    input: GitWatchInputSchema,
    output: GitStatusSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.changes": {
    input: GitChangesInputSchema,
    output: ChangeSetSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.watchChanges": {
    input: GitWatchChangesInputSchema,
    output: ChangeSetSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.patches": {
    input: GitPatchesInputSchema,
    output: PatchSetWireSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.contents": {
    input: GitContentsInputSchema,
    output: GitFileSidesSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.log": {
    input: GitLogInputSchema,
    output: GitLogOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.refs": {
    input: GitRefsInputSchema,
    output: GitRefsViewSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.blame": {
    input: GitBlameInputSchema,
    output: BlameViewSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "git",
  },
  "git.stage": {
    input: GitStageInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  },
  "git.unstage": {
    input: GitUnstageInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  },
  "git.discard": {
    input: GitDiscardInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  },
  "git.commit": {
    input: GitCommitInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  },
  "git.branch": {
    input: GitBranchInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  },
  "git.push": {
    input: GitPushInputSchema,
    output: GitOutcomeSchema,
    kind: "command",
    authority: "owner",
    scope: "workspace",
    capability: "git",
  },

  "browser.open": {
    input: BrowserOpenInputSchema,
    output: PageInfoSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "replay",
  },
  "browser.adopt": {
    input: BrowserAdoptInputSchema,
    output: PageInfoSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "browser.list": {
    input: BrowserListInputSchema,
    output: BrowserListOutputSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "browser.watch": {
    input: BrowserWatchInputSchema,
    output: BrowserWatchOutputSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },

  "page.view": {
    input: PageViewInputSchema,
    output: PageViewSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.watch": {
    input: PageWatchInputSchema,
    output: PageViewSchema,
    kind: "watch",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.snapshot": {
    input: PageSnapshotInputSchema,
    output: PageSnapshotSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.navigate": {
    input: PageNavigateInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.back": {
    input: PageBackInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.forward": {
    input: PageForwardInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.reload": {
    input: PageReloadInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.stopLoading": {
    input: PageStopLoadingInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.click": {
    input: PageClickInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  },
  "page.type": {
    input: PageTypeInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  },
  "page.press": {
    input: PagePressInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  },
  "page.scroll": {
    input: PageScrollInputSchema,
    output: PageOutcomeSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  },
  "page.wait": {
    input: PageWaitInputSchema,
    output: PageOutcomeSchema,
    kind: "query",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.console": {
    input: PageConsoleInputSchema,
    output: PageConsoleOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.capture": {
    input: PageCaptureInputSchema,
    output: PageCaptureOutputSchema,
    kind: "stream",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },
  "page.evaluate": {
    input: PageEvaluateInputSchema,
    output: PageEvaluateOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
    recovery: "never",
  },
  "page.close": {
    input: PageCloseInputSchema,
    output: PageCloseOutputSchema,
    kind: "command",
    authority: "participant",
    scope: "workspace",
    capability: "browser",
  },

  "plugins.replace": {
    input: PluginsReplaceInputSchema,
    output: PluginReplacementReportSchema,
    kind: "command",
    authority: "maintenance",
    scope: "host",
  },
  "plugins.check": {
    input: PluginsCheckInputSchema,
    output: PluginCheckReportSchema,
    kind: "query",
    authority: "maintenance",
    scope: "host",
  },

  "principals.list": {
    input: PrincipalsListInputSchema,
    output: PrincipalsListOutputSchema,
    kind: "query",
    authority: "maintenance",
    scope: "host",
  },
  "principals.pair": {
    input: PrincipalsPairInputSchema,
    output: PrincipalsPairOutputSchema,
    kind: "command",
    authority: "maintenance",
    scope: "host",
  },
  "principals.revoke": {
    input: PrincipalsRevokeInputSchema,
    output: PrincipalsRevokeOutputSchema,
    kind: "command",
    authority: "maintenance",
    scope: "host",
  },
} satisfies {
  readonly [N in keyof Signatures]: Declaration<Signatures[N]["input"], Signatures[N]["output"]>;
};

/** Returns the declaration table's type: each row's literal kind, authority and scope, and its schemas. */
export type Declarations = typeof declarations;

/** Names one served operation: a key of the table. */
export type OperationName = keyof Declarations;

/** Returns one operation's decoded input, as its signature types it. */
export type OperationInput<N extends OperationName> = Signatures[N]["input"];

/** Returns one operation's decoded output, as its signature types it: its value, or one frame of a `watch` or `stream` row. */
export type OperationOutput<N extends OperationName> = Signatures[N]["output"];
