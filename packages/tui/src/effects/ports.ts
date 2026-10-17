import type {
  BlobId,
  CommandOutcome,
  ConfigureOutcome,
  GitHubAccountState,
  GitHubState,
  HostView,
  Json,
  McpChange,
  McpView,
  MessageId,
  ModelAccount,
  ModelCatalogView,
  ModelRef,
  MoveOptions,
  MoveOutcome,
  PartId,
  Position,
  ProviderUsage,
  RunId,
  SendOptions,
  SessionId,
  SessionInfo,
  SessionView,
  SettingOutcome,
  SubmitDraft,
  Thinking,
  TreeView,
  UserContent,
  WorkspaceCatalogView,
  WorkspaceCommandOutcome,
  WorkspaceId,
} from "@nyte-ai/sdk";
import type { ApprovalDecision } from "@nyte-ai/plugin/approvals/schema";
import type { QuestionAnswers } from "@nyte-ai/plugin/question/schema";
import type { Clock } from "@opentui/core";
import type { ResolvedSettings, SettingsPatch } from "../lib/settings-schema.ts";
import type { Task } from "../lib/tasks.ts";
import type { MentionFile } from "../model/completion.ts";
import type { DraftInsert } from "../model/draft.ts";
import type { ComposerPort, ScrollPort } from "../model/native.ts";
import type { Selection } from "../model/state.ts";
import type { McpAction } from "../model/effect.ts";
import type { LoginDriver } from "../services/auth.ts";
import type { SettingsRead } from "../services/settings.ts";

export interface Ports {
  readonly host: HostPort;
  readonly terminal: TerminalPort;
  readonly composer: Handle<ComposerPort>;
  readonly scroll: Handle<ScrollPort>;
  readonly settings: SettingsPort;
  readonly firstFrame: FirstFramePort;
  readonly plugins: PluginsPort;
  readonly shell: ShellPort;
  readonly files: FilesPort;
  readonly clock: Clock;
  readonly log: CrashLog;
}

export interface HostPort {
  session(id: SessionId): SessionPort;
  workspace(id: WorkspaceId): WorkspacePort;
  /** Registers `path`, or the folder the TUI opened in when `null`, as a workspace; with neither, resolves the host's default workspace. */
  openFolder(path: string | null): Promise<WorkspaceId>;
  /** Starts chat `id` with its first message; the same id and input start it once. A start that failed once it landed resolves as started; `taken` means an earlier start made chat `id` with other input. */
  start(input: {
    readonly id: SessionId;
    readonly workspace: WorkspaceId;
    readonly selection: Selection;
    readonly content: UserContent;
  }): Promise<
    { readonly kind: "started"; readonly message: MessageId } | { readonly kind: "taken" }
  >;
  rootSessions(): AsyncIterable<SessionInfo>;
  catalog(): AsyncIterable<Pick<HostView, "catalog" | "settings">>;
  sessionInfos(): AsyncIterable<readonly SessionInfo[]>;
  listModels(): Promise<ModelCatalogView>;
  accounts(provider: string | null): Promise<readonly ModelAccount[]>;
  selectAccount(provider: string, account: string): Promise<void>;
  usage(): Promise<readonly ProviderUsage[]>;
  refreshModels(provider: string): Promise<void>;
  setDefaultModel(ref: ModelRef): Promise<void>;
  login(
    provider: string | null,
    driver: LoginDriver,
  ): Promise<{ readonly provider: string; readonly name: string }>;
  logout(
    provider: string | null,
    driver: LoginDriver,
  ): Promise<{ readonly provider: string; readonly name: string }>;
  hostPlugins(): Promise<HostView["plugins"]>;
  /** The machine's `gh` login and the workspace on GitHub through the host, or `null` where the host serves no GitHub. */
  github(
    workspace: WorkspaceId,
  ): Promise<{ readonly account: GitHubAccountState; readonly folder: GitHubState } | null>;
  mcp(workspace: WorkspaceId): Promise<McpView>;
  mcpAction(workspace: WorkspaceId, server: string, action: McpAction): Promise<McpChange>;
  mcpLogin(workspace: WorkspaceId, server: string, driver: LoginDriver): Promise<void>;
  /** The folder, its saved trust decision, whether its project files load now (`null`: ask), and the files trust would load. */
  trustInfo(workspace: WorkspaceId): Promise<{
    readonly path: string;
    readonly home: boolean;
    readonly decision: boolean | null;
    readonly trusted: boolean | null;
    readonly sources: readonly string[];
  }>;
  trust(workspace: WorkspaceId, value: boolean | null): Promise<void>;
  applySetting(id: string, value: Json): Promise<SettingOutcome>;
  tasks(session: SessionId): AsyncIterable<readonly Task[]>;
  blob(id: string): AsyncIterable<Uint8Array>;
}

export interface WorkspacePort {
  readonly id: WorkspaceId;
  /** The plugin commands and skills a new chat here would offer. */
  catalog(): Promise<WorkspaceCatalogView>;
  /** Runs a command of {@link WorkspacePort.catalog} without a chat; a `prompt` outcome is the first message of the chat it starts. */
  command(name: string, argument: string | null): Promise<WorkspaceCommandOutcome>;
  /** The folder on this machine, or `null` when the workspace is elsewhere. */
  cwd(): Promise<string | null>;
  upload(bytes: Uint8Array): Promise<BlobId>;
  mentions(signal: AbortSignal): Promise<readonly string[]>;
}

export interface SessionPort {
  readonly id: SessionId;
  watch(): AsyncIterable<SessionView>;
  /** Pages up to `limit` older messages into the latest watch's views; resolves how many came, 0 at the session's first message. */
  earlier(limit: number): Promise<number>;
  info(): Promise<SessionInfo>;
  workspace(): Promise<{ readonly id: WorkspaceId; readonly cwd: string | null }>;
  send(content: UserContent, options: SendOptions): Promise<{ readonly message: MessageId }>;
  withdraw(message: MessageId): Promise<"withdrawn" | "landed-first" | "gone">;
  revise(
    message: MessageId,
    content: UserContent,
    options: SendOptions,
  ): Promise<"revised" | "landed-first" | "gone">;
  stopRun(run: RunId): Promise<"stopped" | "missing">;
  answer(part: PartId, answers: QuestionAnswers): Promise<boolean>;
  /** Answers an approval; resolves null once it is taken, else why it was not. */
  approve(part: PartId, decision: ApprovalDecision): Promise<string | null>;
  move(position: Position, options: MoveOptions): Promise<MoveOutcome>;
  tree(): Promise<TreeView>;
  compact(instructions: string | null): Promise<"started" | "busy" | "nothing">;
  configure(patch: {
    readonly model?: ModelRef;
    readonly effort?: Thinking;
  }): Promise<ConfigureOutcome>;
  applySetting(id: string, value: Json): Promise<ConfigureOutcome>;
  command(name: string, argument: string | null): Promise<CommandOutcome>;
  stopTask(
    task:
      | { readonly kind: "agent"; readonly session: SessionId }
      | { readonly kind: "job"; readonly job: string },
  ): Promise<"stopped" | "missing">;
  changeDirectory(
    path: string,
  ): Promise<
    | { readonly kind: "changed"; readonly cwd: string }
    | { readonly kind: "refused"; readonly reason: string }
  >;
  reload(): Promise<"updated" | "missing">;
  upload(bytes: Uint8Array): Promise<BlobId>;
  mentions(signal: AbortSignal): Promise<readonly string[]>;
}

export interface Handle<T> {
  attach(value: T): () => void;
  current(): T | null;
}

export interface TerminalPort {
  setTitle(title: string): void;
  programStatus(encoded: string): void;
  notify(title: string, body: string, sound: boolean): void;
  copy(text: string): void;
  readClipboard(): Promise<
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "image"; readonly bytes: Uint8Array }
    | { readonly kind: "empty" }
  >;
  suspended<T>(work: () => Promise<T>): Promise<T>;
  open(target: string): void;
}

export interface SettingsPort {
  /** Reads synchronously, so the first frame draws with the user's settings; a file that fails to parse is left out and listed. */
  read(cwd: string): SettingsRead;
  write(cwd: string, patch: SettingsPatch): Promise<ResolvedSettings>;
  /** Resolves once every write asked for so far has landed, so a read after it sees them. */
  settled(): Promise<void>;
}

/** What the first frame draws before the host answers: the model a new chat starts on. */
export interface FirstFramePort {
  /** Reads synchronously; `null` when no launch recorded one yet, or the record doesn't parse. */
  read(): Selection | null;
  write(selection: Selection): Promise<void>;
}

export interface PluginsPort {
  readonly ids: readonly string[];
  beforeSubmit(
    draft: SubmitDraft,
  ): Promise<
    | { readonly kind: "accept"; readonly draft: SubmitDraft }
    | { readonly kind: "reject"; readonly reason: string }
  >;
  switched(previous: SessionId | null, next: SessionId): Promise<void>;
}

export type ShellEnd =
  | { readonly kind: "exited"; readonly code: number }
  | { readonly kind: "signalled"; readonly signal: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: string };

export interface ShellPort {
  start(
    id: string,
    command: string,
    cwd: string,
    update: (output: string) => void,
  ): Promise<ShellEnd>;
  stop(id: string): void;
}

export interface FilesPort {
  resolvePaste(text: string, bytes: Uint8Array | null, cwd: string): Promise<DraftInsert>;
  listDirectory(path: string, cwd: string): Promise<readonly string[]>;
  resolveMention(query: string, cwd: string): Promise<MentionFile | null>;
  readText(path: string): Promise<string | null>;
  editor(text: string, command: string | null): Promise<string | null>;
}

export interface CrashLog {
  readonly path: string;
  write(origin: string, error: unknown): void;
}
