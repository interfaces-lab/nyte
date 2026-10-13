/**
 * Everything the runner may touch, as narrow interfaces. Production wires
 * them to the SDK, the renderer and the services; tests wire fakes. Nothing
 * outside `effects/` and `app/main.tsx` can reach a port, so a component
 * cannot call the SDK.
 */
import type {
  BlobId,
  CommandOutcome,
  ConfigureOutcome,
  HostView,
  Json,
  MessageId,
  ModelCatalogView,
  ModelRef,
  MoveOptions,
  MoveOutcome,
  PartId,
  Position,
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
import type { ResolvedSettings, SettingsPatch } from "../lib/settings-schema.ts";
import type { Task } from "../lib/tasks.ts";
import type { MentionFile } from "../model/completion.ts";
import type { DraftInsert } from "../model/draft.ts";
import type { ComposerPort, ScrollPort } from "../model/native.ts";
import type { Selection } from "../model/state.ts";
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

/** The SDK as the TUI uses it. Receipts, branded ids and wire outcomes stay inside the adapter. */
export interface HostPort {
  session(id: SessionId): SessionPort;
  create(input: {
    readonly workspace: WorkspaceId | null;
    readonly selection: Selection | null;
  }): Promise<SessionId>;
  /** Every root session, newest activity first, across the directory's pages. */
  rootSessions(): Promise<readonly SessionInfo[]>;
  /** One entry per catalog generation the host reports; `list` reads the catalog for it. */
  catalog(): AsyncIterable<{
    readonly generation: number;
    readonly list: () => Promise<ModelCatalogView>;
  }>;
  /** Every session's info, again whenever one changes (a rename included). */
  sessionInfos(): AsyncIterable<readonly SessionInfo[]>;
  listModels(): Promise<ModelCatalogView>;
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
  /** The host's loaded plugins as its view reports them. */
  hostPlugins(): Promise<HostView["plugins"]>;
  applySetting(id: string, value: Json): Promise<SettingOutcome>;
  tasks(session: SessionId): AsyncIterable<readonly Task[]>;
  blob(id: string): AsyncIterable<Uint8Array>;
}

export interface SessionPort {
  readonly id: SessionId;
  watch(): AsyncIterable<SessionView>;
  info(): Promise<SessionInfo>;
  /** The folder the session's workspace serves, or null when it is not a local path. */
  workspace(): Promise<{ readonly id: WorkspaceId; readonly cwd: string | null }>;
  send(content: UserContent, options: SendOptions): Promise<{ readonly message: MessageId }>;
  /**
   * `session.receipt(asId<"receipt">(message)).stop()`: works for any client's
   * pending message, not only receipts this process holds. The runner calls
   * it only after `read()` shows the message still pending; "landed-first"
   * means the stop settled as a run end rather than `withdrawn`.
   */
  withdraw(message: MessageId): Promise<"withdrawn" | "landed-first" | "gone">;
  revise(
    message: MessageId,
    content: UserContent,
    options: SendOptions,
  ): Promise<"revised" | "landed-first" | "gone">;
  stopRun(run: RunId): Promise<"stopped" | "missing">;
  answer(part: PartId, choice: string): Promise<boolean>;
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
  /** Re-reads the workspace's project resources. */
  reload(): Promise<"updated" | "missing">;
  /** Uploads pasted image bytes through the workspace's files, for a message to carry. */
  upload(bytes: Uint8Array): Promise<BlobId>;
  /** Workspace-relative paths an `@` mention can name; folders end in `/`. */
  mentions(signal: AbortSignal): Promise<readonly string[]>;
}

/** A native renderable's handle, attached by the component that owns it while mounted. */
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
  /** Suspends the renderer around an external program (the editor). */
  suspended<T>(work: () => Promise<T>): Promise<T>;
  open(target: string): void;
  /** Resolves once the current frame is drawn: boot paints before host work starts. */
  painted(): Promise<void>;
}

export interface SettingsPort {
  read(cwd: string): Promise<ResolvedSettings>;
  write(cwd: string, patch: SettingsPatch): Promise<ResolvedSettings>;
}

export interface PluginsPort {
  /** The client plugins mounted, for `/plugins`. */
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
  /** What an `@` query spelled as a path names under `cwd`: a file or folder, else null. */
  resolveMention(query: string, cwd: string): Promise<MentionFile | null>;
  /** Reads a file's body for inlining, or null when it is binary, oversized or unreadable. */
  readText(path: string): Promise<string | null>;
  editor(text: string, command: string | null): Promise<string | null>;
}

export interface Clock {
  now(): number;
}

export interface CrashLog {
  readonly path: string;
  write(origin: string, error: unknown): void;
}
