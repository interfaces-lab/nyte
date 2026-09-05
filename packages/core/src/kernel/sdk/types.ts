/**
 * The kernel SDK contract: plain data and one options object per verb, so a
 * protocol layer can mirror it without reshaping it.
 *
 * The plain data (ids, read models, outcomes, the session event) is declared
 * in `@nyte-ai/protocol` and re-exported here, so core, the desktop, and a
 * remote client read one definition. What stays here is host-facing: the
 * verb interfaces (some take an `AbortSignal`), the composition options, and
 * the errors the SDK throws.
 *
 * Streaming deltas key on `(runId, attempt, index)`, not a commit id. A
 * commit's id is its content hash, so it cannot exist until the complete
 * message exists. The tuple identifies a provisional part while it streams;
 * the settled commit supplies its durable identity afterward.
 */
import type { Api, JsonValue, Model, Skill } from "@nyte-ai/schema";
import type {
  AbortOutcome,
  ApplyOutcome,
  CancelOutcome,
  CommandInfo,
  CommandOutcome,
  CompactOutcome,
  ConfigureOutcome,
  ContextStatus,
  CreateHeadOutcome,
  DeleteHeadOutcome,
  FileChange,
  HeadInfo,
  HeadName,
  Lane,
  Landing,
  MergeOutcome,
  ModelInfo,
  MoveOutcome,
  Oid,
  Page,
  PendingItem,
  PluginCatalog,
  RedeliverOutcome,
  ReplyOutcome,
  RunId,
  RunInfo,
  SendInput,
  SendReceipt,
  Seq,
  SessionEvent,
  SessionId,
  SessionInfo,
  SessionParent,
  SessionSnapshot,
  Turn,
  VcsDiff,
  VcsStatus,
  WaitOutcome,
  WorkspaceInfo,
} from "@nyte-ai/protocol";
import type {
  Disposer,
  LoadedPlugin,
  PluginEnv,
  PluginInfo,
  SettingInfo,
} from "../../plugins/types.ts";
import type { StreamFn, StreamOptions, ThinkingLevel } from "../../types.ts";
import type { WorkspaceRegistryBackend } from "../../workspace-registry.ts";
import type { CompactionSettings } from "../compaction.ts";
import type { Actor } from "../model.ts";
import type { Store } from "../store.ts";

export {
  DEFAULT_LANDING,
  MAIN,
  sessionId,
  type AbortOutcome,
  type Actor,
  type ApplyOutcome,
  type CancelOutcome,
  type CommandInfo,
  type CommandOutcome,
  type CompactOutcome,
  type ConfigureOutcome,
  type ContextStatus,
  type CreateHeadOutcome,
  type DeleteHeadOutcome,
  type FileChange,
  type HeadInfo,
  type HeadName,
  type Lane,
  type Landing,
  type LanePolicy,
  type MergeOutcome,
  type ModelInfo,
  type MoveOutcome,
  type Oid,
  type Page,
  type ParkedCall,
  type PendingItem,
  type PluginCatalog,
  type RedeliverOutcome,
  type ReplyOutcome,
  type RunConfig,
  type RunId,
  type RunInfo,
  type RunPhase,
  type SendInput,
  type SendReceipt,
  type Seq,
  type SessionEvent,
  type SessionId,
  type SessionInfo,
  type SessionParent,
  type SessionSnapshot,
  type ToolProgress,
  type Turn,
  type VcsDiff,
  type VcsStatus,
  type WaitOutcome,
  type WorkspaceInfo,
} from "@nyte-ai/protocol";
export type { WorkspaceRegistryBackend } from "../../workspace-registry.ts";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface Sessions {
  create(input?: {
    readonly sessionId?: SessionId;
    readonly name?: string;
    readonly parent?: SessionParent;
  }): Promise<SessionInfo>;
  get(input: { readonly sessionId: SessionId }): Promise<SessionInfo | undefined>;
  snapshot(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
  }): Promise<SessionSnapshot | undefined>;
  list(input?: {
    readonly search?: string;
    readonly limit?: number;
    readonly cursor?: string;
    readonly parent?: SessionId | null;
    readonly includeArchived?: boolean;
  }): Promise<Page<SessionInfo>>;
  rename(input: { readonly sessionId: SessionId; readonly name: string }): Promise<void>;
  setPinned(input: { readonly sessionId: SessionId; readonly pinned: boolean }): Promise<void>;
  setArchived(input: { readonly sessionId: SessionId; readonly archived: boolean }): Promise<void>;
  delete(input: { readonly sessionId: SessionId }): Promise<void>;
  configure(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly model?: { readonly provider: string; readonly id: string };
    readonly thinkingLevel?: ThinkingLevel;
    readonly agent?: string;
  }): Promise<ConfigureOutcome>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface Messages {
  send(input: SendInput): Promise<SendReceipt>;
  cancel(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly change: Oid;
  }): Promise<CancelOutcome>;
  redeliver(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly change: Oid;
    readonly lane: Lane;
    readonly content?: SendInput["content"];
    /** Keep position when omitted; move before this pending item, or to the end with null. */
    readonly before?: Oid | null;
  }): Promise<RedeliverOutcome>;
  list(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
  }): Promise<readonly Turn[]>;
  pending(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
  }): Promise<readonly PendingItem[]>;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface Runs {
  current(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
  }): Promise<RunInfo | undefined>;
  abort(input: { readonly sessionId: SessionId; readonly head?: HeadName }): Promise<AbortOutcome>;
  wait(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly signal?: AbortSignal;
  }): Promise<WaitOutcome>;
  reply(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly runId?: RunId;
    readonly callId: string;
    readonly reply: JsonValue;
  }): Promise<ReplyOutcome>;
  compact(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly customInstructions?: string;
    readonly signal?: AbortSignal;
  }): Promise<CompactOutcome>;
  context(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
  }): Promise<ContextStatus>;
  changes(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly runId?: RunId;
  }): Promise<readonly FileChange[]>;
}

// ---------------------------------------------------------------------------
// Heads
// ---------------------------------------------------------------------------

export interface Heads {
  list(input: { readonly sessionId: SessionId }): Promise<readonly HeadInfo[]>;
  create(input: {
    readonly sessionId: SessionId;
    readonly head: HeadName;
    readonly from: { readonly head: HeadName } | { readonly commit: Oid };
  }): Promise<CreateHeadOutcome>;
  move(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly to: Oid | null;
    readonly expect?: Oid | null;
    readonly summary?: { readonly customInstructions?: string };
  }): Promise<MoveOutcome>;
  delete(input: {
    readonly sessionId: SessionId;
    readonly head: HeadName;
  }): Promise<DeleteHeadOutcome>;
  merge(input: { readonly sessionId: SessionId; readonly head: HeadName }): Promise<MergeOutcome>;
}

// ---------------------------------------------------------------------------
// Workspace and provider
// ---------------------------------------------------------------------------

export interface VcsBackend {
  status(): Promise<VcsStatus>;
  diff(input?: { readonly paths?: readonly string[] }): Promise<readonly VcsDiff[]>;
}

export interface Workspace {
  list(): Promise<readonly WorkspaceInfo[]>;
  forget(input: { readonly path: string }): Promise<void>;
  vcs: {
    status(): Promise<VcsStatus | undefined>;
    diff(input?: { readonly paths?: readonly string[] }): Promise<readonly VcsDiff[]>;
  };
}

export interface Provider {
  models: {
    list(): Promise<readonly ModelInfo[]>;
    default(): Promise<ModelInfo | undefined>;
  };
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export interface Plugins {
  /** Plugin inventory contributed for a new session, without creating one. */
  catalog(): Promise<PluginCatalog>;
  list(input: { readonly sessionId: SessionId }): Promise<readonly PluginInfo[]>;
  commands: {
    list(input: { readonly sessionId: SessionId }): Promise<readonly CommandInfo[]>;
    run(input: {
      readonly sessionId: SessionId;
      readonly name: string;
      readonly argument?: string;
    }): Promise<CommandOutcome>;
  };
  settings: {
    list(input: { readonly sessionId: SessionId }): Promise<readonly SettingInfo[]>;
    apply(input: {
      readonly sessionId: SessionId;
      readonly id: string;
      readonly choiceId: string;
    }): Promise<ApplyOutcome>;
  };
  resources: {
    list(input: { readonly sessionId: SessionId }): Promise<readonly Skill[]>;
  };
  status: {
    /** The plugin status items in display order; `status_changed` carries the same list live. */
    list(input: { readonly sessionId: SessionId }): Promise<readonly string[]>;
  };
}

// ---------------------------------------------------------------------------
// Errors and root
// ---------------------------------------------------------------------------

export class NyteClosed extends Error {
  readonly kind = "closed" satisfies "closed";

  constructor() {
    super("nyte is closed");
    this.name = "NyteClosed";
  }
}

export class UnknownSession extends Error {
  readonly kind = "not_found" satisfies "not_found";
  readonly what = "session" satisfies "session";

  constructor(id: string) {
    super(`Unknown session: ${id}`);
    this.name = "UnknownSession";
  }
}

export type { Disposer };

export interface AttachOptions {
  readonly sessions?: readonly SessionId[];
}

interface NyteBaseOptions {
  readonly store: Store;
  readonly streamFn: StreamFn;
  readonly models: ModelCatalog;
  readonly model: Model<Api>;
  /** The lanes this host serves and when each lands. Absent means `DEFAULT_LANDING`. */
  readonly landing?: Landing;
  readonly actor?: Actor;
  readonly thinkingLevel?: ThinkingLevel;
  readonly compaction?: CompactionSettings;
  readonly streamOptions?: StreamOptions;
  readonly vcs?: VcsBackend;
  readonly workspaces?: WorkspaceRegistryBackend;
}

export interface ActiveSessionActivation {
  readonly kind: "active";
  readonly plugins: readonly LoadedPlugin[];
  readonly env: PluginEnv;
}

export type SessionActivation = ActiveSessionActivation | { readonly kind: "inactive" };

export type ActivationTarget =
  | { readonly kind: "new-session" }
  | { readonly kind: "session"; readonly sessionId: SessionId };

export type SessionActivationResolver = (
  target: ActivationTarget,
) => SessionActivation | Promise<SessionActivation>;

export interface StaticNyteOptions extends NyteBaseOptions {
  readonly plugins: readonly LoadedPlugin[];
  readonly env: PluginEnv;
  readonly resolveActivation?: never;
}

export interface LazyNyteOptions extends NyteBaseOptions {
  readonly plugins?: never;
  readonly env?: never;
  readonly resolveActivation: SessionActivationResolver;
}

export type NyteOptions = StaticNyteOptions | LazyNyteOptions;

export interface ModelCatalog {
  getModels(provider?: string): readonly Model<Api>[];
  getModel(provider: string, id: string): Model<Api> | undefined;
}

export interface Nyte {
  /** The landing policy in force: the lanes a client may send to, in the runner's priority order. */
  readonly landing: Landing;
  readonly sessions: Sessions;
  readonly messages: Messages;
  readonly runs: Runs;
  readonly heads: Heads;
  readonly workspace: Workspace;
  readonly provider: Provider;
  readonly plugins: Plugins;
  watch(
    input: { readonly sessionId: SessionId; readonly signal?: AbortSignal } & (
      | { readonly afterSeq?: Seq }
      | { readonly live: true }
    ),
  ): AsyncIterable<SessionEvent>;
  attach(input?: AttachOptions): Disposer;
  setPlugins(plugins: readonly LoadedPlugin[]): Promise<void>;
  close(): Promise<void>;
}
