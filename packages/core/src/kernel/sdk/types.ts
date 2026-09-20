/**
 * The kernel SDK contract: plain data and one options object per operation, so a
 * protocol layer can mirror it without reshaping it.
 *
 * The plain data (ids, read models, outcomes, the session event) is declared
 * in `@nyte-ai/protocol` and re-exported here, so core, the desktop, and a
 * remote client read one definition. What stays here is host-facing: the
 * operation interfaces (some take an `AbortSignal`), the composition options, and
 * the errors the SDK throws.
 *
 * Streaming deltas key on `(runId, attempt, index)`, not a commit id. A
 * commit's id is its content hash, so it cannot exist until the complete
 * message exists. The tuple identifies a provisional part while it streams;
 * the settled commit supplies its durable identity afterward.
 */
import type { Models } from "@nyte-ai/ai";
import type { Api, Model, Skill } from "@nyte-ai/schema";
import type { TelemetryContext } from "@nyte-ai/telemetry";
import type {
  AbortOutcome,
  Operation,
  OperationInput,
  ApplyOutcome,
  CancelOutcome,
  CommandInfo,
  CommandOutcome,
  CompactOutcome,
  ConfigureOutcome,
  ContextStatus,
  CreateHeadOutcome,
  DeleteHeadOutcome,
  FileDiff,
  HeadInfo,
  HeadName,
  RemoteJobs,
  Lane,
  Landing,
  MentionFile,
  MergeOutcome,
  ModelInfo,
  MoveOutcome,
  Oid,
  Page,
  PendingItem,
  PluginCatalog,
  RedeliverOutcome,
  ReplyOutcome,
  RunDiff,
  RunInfo,
  RunRevert,
  SendInput,
  SendReceipt,
  Seq,
  SessionEvent,
  SessionId,
  SessionInfo,
  SessionMetadata,
  SessionParent,
  SessionActivationState,
  SessionSnapshot,
  TreeId,
  TreeOutcome,
  Turn,
  VcsBranchOutcome,
  VcsCommitOutcome,
  VcsContents,
  VcsDiff,
  VcsDiscardOutcome,
  VcsLog,
  VcsPathsOutcome,
  VcsPushOutcome,
  VcsRefs,
  VcsSnapshot,
  WaitOutcome,
  WorkspaceInfo,
  WorkspaceSelectInput,
  WorkspaceSelectOutcome,
  WorkspaceSelection,
} from "@nyte-ai/protocol";
import type {
  Disposer,
  LoadedPlugin,
  PluginEnv,
  PluginInfo,
  SettingInfo,
} from "../../plugins/types.ts";
import type { StreamFn, StreamOptions, ThinkingLevel } from "../loop/types.ts";
import type { CompactionSettings } from "../compaction.ts";
import type { Actor, Run } from "../model.ts";
import type { StepOutcome } from "../step.ts";
import type { Store } from "../store.ts";

export {
  DEFAULT_LANDING,
  MAIN,
  sessionId,
  type ActivationRequirement,
  type AbortOutcome,
  type Actor,
  type ApplyOutcome,
  type Choice,
  type CancelOutcome,
  type CommandInfo,
  type CommandOutcome,
  type CompactOutcome,
  type CompactionInfo,
  type ConfigureOutcome,
  type ContextStatus,
  type CreateHeadOutcome,
  type DeleteHeadOutcome,
  type FileChange,
  type FileDiff,
  type HeadInfo,
  type HeadName,
  type JobInfo,
  type JobActionOutcome,
  type Lane,
  type Landing,
  type LanePolicy,
  type MentionFile,
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
  type RunDiff,
  type RunId,
  type RunInfo,
  type RunRevert,
  type RunPhase,
  type SendInput,
  type Selection,
  type SelectionReply,
  type SendReceipt,
  type Seq,
  type SessionEvent,
  type SessionId,
  type SessionInfo,
  type SessionMetadata,
  type SessionParent,
  type SessionActivationState,
  type SessionSnapshot,
  type ToolProgress,
  type TreeId,
  type TreeOutcome,
  type Turn,
  type VcsBranchOutcome,
  type VcsCommitInfo,
  type VcsCommitOutcome,
  type VcsCommitTarget,
  type VcsContents,
  type VcsDiff,
  type VcsDiscardOutcome,
  type VcsFile,
  type VcsFileKind,
  type VcsHead,
  type VcsLog,
  type VcsPathsOutcome,
  type VcsPushOutcome,
  type VcsRefs,
  type VcsScope,
  type VcsSnapshot,
  type WaitOutcome,
  type WorkspaceInfo,
  type WorkspaceSelectInput,
  type WorkspaceSelectOutcome,
  type WorkspaceSelection,
} from "@nyte-ai/protocol";

export const TRUSTED_WORKSPACE: unique symbol = Symbol("TrustedWorkspace");

/** A realpath workspace that passed the host's trust decision. */
export interface TrustedWorkspace {
  readonly cwd: string;
  readonly [TRUSTED_WORKSPACE]: true;
}

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
  /** The snapshot's session row, head inputs, and context, without its transcript or queue. */
  metadata(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
  }): Promise<SessionMetadata | undefined>;
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

export type RunRevertOutcome =
  | RunRevert
  | { readonly kind: "conflict"; readonly paths: readonly string[] };

export interface Runs {
  current(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
  }): Promise<RunInfo | undefined>;
  abort(input: OperationInput<"runs.abort">): Promise<AbortOutcome>;
  wait(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly signal?: AbortSignal;
  }): Promise<WaitOutcome>;
  reply(input: OperationInput<"runs.reply">): Promise<ReplyOutcome>;
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
  diff(input: OperationInput<"runs.diff">): Promise<RunDiff>;
  revert(
    input: OperationInput<"runs.revert"> & { readonly expect: TreeId },
  ): Promise<RunRevertOutcome>;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Job operations share the protocol signatures; none takes host-only options. */
export type Jobs = RemoteJobs;

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

/** One operation's input with the directory the host resolved for it. */
type InWorkspace<V extends Operation> = Omit<OperationInput<V>, "sessionId"> & {
  readonly cwd: string;
};

export type VcsMutationOutcome<Outcome> = Outcome | { readonly kind: "stale" };

/**
 * Version control at a directory. Every operation takes the `cwd` the SDK
 * resolved from the session or the host's workspace; the backend decides what
 * repository, if any, contains it.
 */
export interface VcsBackend {
  snapshot(input: { readonly cwd: string }): Promise<VcsSnapshot>;
  diff(input: InWorkspace<"workspace.vcs.diff">): Promise<readonly VcsDiff[]>;
  contents(input: InWorkspace<"workspace.vcs.contents">): Promise<VcsContents>;
  log(input: InWorkspace<"workspace.vcs.log">): Promise<VcsLog>;
  refs(input: { readonly cwd: string }): Promise<VcsRefs>;
  stage(
    input: InWorkspace<"workspace.vcs.stage"> & { readonly expect: { readonly revision: string } },
  ): Promise<VcsMutationOutcome<VcsPathsOutcome>>;
  discard(
    input: InWorkspace<"workspace.vcs.discard"> & {
      readonly expect: { readonly revision: string };
    },
  ): Promise<VcsMutationOutcome<VcsPathsOutcome>>;
  commit(
    input: InWorkspace<"workspace.vcs.commit"> & {
      readonly expect: { readonly revision: string };
    },
  ): Promise<VcsMutationOutcome<VcsCommitOutcome>>;
  createBranch(
    input: InWorkspace<"workspace.vcs.createBranch"> & {
      readonly expect: { readonly revision: string };
    },
  ): Promise<VcsMutationOutcome<VcsBranchOutcome>>;
  push(
    input: InWorkspace<"workspace.vcs.push"> & { readonly expect: { readonly revision: string } },
  ): Promise<VcsMutationOutcome<VcsPushOutcome>>;
  tree(input: { readonly cwd: string }): Promise<TreeOutcome>;
  diffTrees(input: {
    readonly cwd: string;
    readonly from: TreeId;
    readonly to: TreeId;
    readonly paths?: readonly string[];
  }): Promise<readonly FileDiff[]>;
  restoreTree(input: {
    readonly cwd: string;
    readonly from: TreeId;
    readonly expect: TreeId;
    readonly paths: readonly FileDiff[];
  }): Promise<
    | { readonly kind: "restored"; readonly files: readonly string[] }
    | { readonly kind: "conflict"; readonly paths: readonly string[] }
    | { readonly kind: "failed"; readonly reason: string }
  >;
}

/** Everything the SDK's `workspace` namespace answers from; the host supplies it all. */
export interface WorkspaceBackend {
  list(): Promise<readonly WorkspaceInfo[]>;
  touch(path: string, now?: number): Promise<void>;
  forget(path: string): Promise<void>;
  /** Files and folders `@` can name under `cwd`, ranked by `query`; the backend caps the count. */
  files(input: {
    readonly cwd: string;
    readonly query?: string;
    readonly signal?: AbortSignal;
  }): Promise<readonly MentionFile[]>;
  readonly vcs?: VcsBackend;
}

export interface Workspace {
  list(): Promise<readonly WorkspaceInfo[]>;
  current(): Promise<WorkspaceSelection>;
  select(input: WorkspaceSelectInput): Promise<WorkspaceSelectOutcome>;
  forget(input: { readonly path: string }): Promise<void>;
  /**
   * Files and folders `@` can name, narrowed on the host. `sessionId` picks the
   * session's directory; without one the directory a new session would start in
   * answers. The host caps how many come back.
   */
  files(input?: {
    readonly sessionId?: SessionId;
    readonly query?: string;
  }): Promise<readonly MentionFile[]>;
  /**
   * Version control where a session runs, or where a new one would start.
   * Without a backend, reads answer empty and writes answer `failed`.
   */
  vcs: {
    snapshot(input?: OperationInput<"workspace.vcs.snapshot">): Promise<VcsSnapshot>;
    diff(input: OperationInput<"workspace.vcs.diff">): Promise<readonly VcsDiff[]>;
    contents(input: OperationInput<"workspace.vcs.contents">): Promise<VcsContents>;
    log(input: OperationInput<"workspace.vcs.log">): Promise<VcsLog>;
    refs(input?: OperationInput<"workspace.vcs.refs">): Promise<VcsRefs>;
    stage(
      input: OperationInput<"workspace.vcs.stage"> & {
        readonly expect: { readonly revision: string };
      },
    ): Promise<VcsMutationOutcome<VcsPathsOutcome>>;
    /** Refused with `busy` while any head in this workspace has a live run. */
    discard(
      input: OperationInput<"workspace.vcs.discard"> & {
        readonly expect: { readonly revision: string };
      },
    ): Promise<VcsMutationOutcome<VcsDiscardOutcome>>;
    commit(
      input: OperationInput<"workspace.vcs.commit"> & {
        readonly expect: { readonly revision: string };
      },
    ): Promise<VcsMutationOutcome<VcsCommitOutcome>>;
    createBranch(
      input: OperationInput<"workspace.vcs.createBranch"> & {
        readonly expect: { readonly revision: string };
      },
    ): Promise<VcsMutationOutcome<VcsBranchOutcome>>;
    push(
      input: OperationInput<"workspace.vcs.push"> & {
        readonly expect: { readonly revision: string };
      },
    ): Promise<VcsMutationOutcome<VcsPushOutcome>>;
  };
}

export interface Provider {
  models: {
    /** Model choices permitted by the host's current credentials and provider restrictions. */
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

export { CorruptObject, UnknownSession } from "../store.ts";

export type { Disposer };

export interface AttachOptions {
  readonly sessions?: readonly SessionId[];
}

/** Host scheduler state. It contains no credentials, provider output, or kernel objects. */
export type AdvanceOutcome =
  | Exclude<StepOutcome, { readonly run: Run } | { readonly kind: "busy" }>
  | Omit<Extract<StepOutcome, { readonly kind: "finished" }>, "run">
  | Omit<Extract<StepOutcome, { readonly kind: "waiting" }>, "run">
  | Omit<Extract<StepOutcome, { readonly kind: "retry" }>, "run">
  | {
      readonly kind: "busy";
      readonly until: Extract<StepOutcome, { readonly kind: "busy" }>["holder"]["expiresAt"];
    };

/** Host-only cause; never send this record over IPC, events, or telemetry. */
export type SummaryDiagnostic = Extract<MoveOutcome, { readonly code: "internal" }> & {
  readonly operation: "runs.compact" | "heads.move";
  readonly cause: unknown;
};

interface NyteBaseOptions {
  /** Receives converted summary failures once, before the public outcome is returned. */
  readonly onDiagnostic?: (diagnostic: SummaryDiagnostic) => void | Promise<void>;
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
  /** default: records nothing */
  readonly telemetry?: TelemetryContext;
  readonly workspace?: WorkspaceBackend;
}

export interface ActiveSessionActivation {
  readonly kind: "active";
  readonly plugins: readonly LoadedPlugin[];
  readonly env: PluginEnv;
}

export type SessionActivation =
  | ActiveSessionActivation
  | Exclude<SessionActivationState, { readonly kind: "active" }>;

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

export type ModelCatalog = Pick<Models, "getModels" | "getModel" | "getAvailable">;

export interface Nyte {
  /** The landing policy in force: the lanes a client may send to, in the runner's priority order. */
  readonly landing: Landing;
  readonly sessions: Sessions;
  readonly messages: Messages;
  readonly runs: Runs;
  readonly jobs: Jobs;
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
  /** Host-only, one leased kernel step. The caller schedules further steps and deadlines. */
  advance(input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly signal?: AbortSignal;
  }): Promise<AdvanceOutcome>;
  reactivate(): Promise<void>;
  /** Host-only location read. A saved path is not a trust grant. */
  sessionCwd(input: { readonly sessionId: SessionId }): Promise<string | undefined>;
  /** Replace one idle session's environment and plugins, keeping its store and history. */
  relocate(input: {
    readonly sessionId: SessionId;
    readonly workspace: TrustedWorkspace;
    readonly plugins: readonly LoadedPlugin[];
  }): Promise<{ readonly kind: "relocated" } | { readonly kind: "busy" }>;
  setPlugins(
    plugins: readonly LoadedPlugin[],
    input?: { readonly sessionId: SessionId },
  ): Promise<void>;
  /**
   * Hold every runner's next step until the returned disposer runs. A host
   * takes the hold when it sees plugin sources change and releases it after
   * `setPlugins`, so a tool the model just wrote is in its very next request.
   */
  holdPlugins(): Disposer;
  close(): Promise<void>;
}
