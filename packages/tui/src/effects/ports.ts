import type {
  BlobId,
  CommandOutcome,
  ConfigureOutcome,
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
  WorkspaceId,
} from "@nyte-ai/sdk";
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

export type { ComposerPort, ScrollPort };

export interface Ports {
  readonly host: HostPort;
  readonly terminal: TerminalPort;
  readonly composer: Handle<ComposerPort>;
  readonly scroll: Handle<ScrollPort>;
  readonly settings: SettingsPort;
  readonly plugins: PluginsPort;
  readonly shell: ShellPort;
  readonly files: FilesPort;
  readonly clock: Clock;
  readonly log: CrashLog;
}

export interface HostPort {
  session(id: SessionId): SessionPort;
  create(input: {
    readonly workspace: WorkspaceId | null;
    readonly selection: Selection | null;
  }): Promise<SessionId>;
  rootSessions(): AsyncIterable<SessionInfo>;
  catalog(): AsyncIterable<Pick<HostView, "catalog">>;
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

export interface SessionPort {
  readonly id: SessionId;
  watch(): AsyncIterable<SessionView>;
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
  read(cwd: string): Promise<ResolvedSettings>;
  write(cwd: string, patch: SettingsPatch): Promise<ResolvedSettings>;
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
