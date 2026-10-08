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
import type { Api, JsonValue, Model, Skill } from "@nyte-ai/schema";
import type { TelemetryContext } from "@nyte-ai/telemetry";
import type {
  AbortOutcome,
  ActivationRequirement,
  Operation,
  OperationInput,
  OperationOutput,
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
  Delivery,
  Drain,
  MentionFile,
  MergeOutcome,
  ModelInfo,
  MoveOutcome,
  Oid,
  Page,
  PendingItem,
  PluginCatalog,
  ProviderAuthStatus,
  RedeliverOutcome,
  ReplyOutcome,
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
  VcsChange,
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
  WorkspaceRef,
  WorkspaceSelectInput,
  WorkspaceSelectOutcome,
  WorkspaceSelection,
  WorkspaceTarget,
} from "@nyte-ai/protocol";
import type { Disposer, Plugin, PluginInfo, SettingInfo } from "../../plugins/types.ts";
import type { StreamFn, ThinkingLevel } from "../loop/types.ts";
import type { ExecutionEnv } from "../loop/env.ts";
import type { StreamOptions } from "../stream-options.ts";
import type { CacheWarmingMode, CacheWarmingStatus } from "../cache-warmer.ts";
import type { CompactionSettings } from "../compaction.ts";
import type { Actor, Run } from "../model.ts";
import type { StepOutcome } from "../step.ts";
import type { Store } from "../store.ts";

export {
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
  type Delivery,
  type Drain,
  type MentionFile,
  type MergeOutcome,
  type ModelInfo,
  type MoveOutcome,
  type Oid,
  type Page,
  type ParkedCall,
  type PendingItem,
  type PluginCatalog,
  type ProviderAuthStatus,
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
  type VcsChange,
  type VcsCommitInfo,
  type VcsCommitOutcome,
  type VcsCommitTarget,
  type VcsContents,
  type VcsDiff,
  type VcsDiscardOutcome,
  type VcsFile,
  type VcsFileKind,
  type VcsHead,
  type VcsLineStat,
  type VcsLog,
  type VcsPathsOutcome,
  type VcsPushOutcome,
  type VcsRefs,
  type VcsScope,
  type VcsSnapshot,
  type WaitOutcome,
  type WorkspaceInfo,
  type WorkspaceRef,
  type WorkspaceSelectInput,
  type WorkspaceSelectOutcome,
  type WorkspaceSelection,
  type WorkspaceTarget,
} from "@nyte-ai/protocol";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Where a session tree acts, stored on its root: the client ref plus a
 * `locator` the kind's provider reopens it with. The locator is plain text, so
 * keep credentials out. Children act in their root's.
 */
export type Workspace = WorkspaceRef & { readonly locator?: JsonValue };

/** A session tree's root, the workspace it acts in, and the parent links from the session to it. */
export interface SessionRoot {
  readonly sessionId: SessionId;
  readonly workspace: Workspace;
  /** Parent links followed from the session to the root; a root's is 0. */
  readonly depth: number;
}

export interface Sessions {
  /** A root acts in `workspace`, or where the host starts new sessions; a child acts in its root's. */
  create(
    input?: { readonly sessionId?: SessionId; readonly name?: string } & (
      | { readonly parent?: SessionParent; readonly workspace?: never }
      | { readonly parent?: never; readonly workspace?: Workspace }
    ),
  ): Promise<SessionInfo>;
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
  /** Newest first. A page is `limit` rows from `cursor`, the position the previous page handed back. */
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
    readonly delivery: Delivery;
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
  diff(input: OperationInput<"runs.diff">): Promise<OperationOutput<"runs.diff">>;
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
type InWorkspace<V extends Operation> = Omit<OperationInput<V>, "target"> & {
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
  changes(input: InWorkspace<"workspace.vcs.changes">): Promise<readonly VcsChange[]>;
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

/**
 * Everything the SDK's `workspace` namespace answers from; the host supplies it
 * all. It reads the default workspace's environment, so a session that is not
 * active, or acts in any other environment, gets none of it.
 */
export interface WorkspaceBackend {
  list(): Promise<readonly WorkspaceInfo[]>;
  touch(path: string, now?: number): Promise<void>;
  forget(path: string): Promise<void>;
  /** Files and folders under `cwd`: all of them without `query`, otherwise ranked by it and capped. */
  files(input: {
    readonly cwd: string;
    readonly query?: string;
    readonly signal?: AbortSignal;
  }): Promise<readonly MentionFile[]>;
  read(input: InWorkspace<"workspace.read">): Promise<OperationOutput<"workspace.read">>;
  save(input: InWorkspace<"workspace.save">): Promise<OperationOutput<"workspace.save">>;
  format(input: InWorkspace<"workspace.format">): Promise<OperationOutput<"workspace.format">>;
  search(input: InWorkspace<"workspace.search">): Promise<OperationOutput<"workspace.search">>;
  blame(input: InWorkspace<"workspace.blame">): Promise<OperationOutput<"workspace.blame">>;
  readonly vcs?: VcsBackend;
}

/** The SDK's folder namespace: the picker, files, and version control of local directories. Not where a session acts; see `Workspace`. */
export interface WorkspaceApi {
  list(): Promise<readonly WorkspaceInfo[]>;
  current(): Promise<WorkspaceSelection>;
  select(input: WorkspaceSelectInput): Promise<WorkspaceSelectOutcome>;
  forget(input: { readonly path: string }): Promise<void>;
  /**
   * Files and folders in the workspace. Without `query` every one comes back,
   * which the Files tree needs; with one the host ranks and caps them for an `@`
   * menu. `target` picks a session's directory or the one a new session would
   * start in.
   */
  files(input: {
    readonly target: WorkspaceTarget;
    readonly query?: string;
  }): Promise<readonly MentionFile[]>;
  read(input: OperationInput<"workspace.read">): Promise<OperationOutput<"workspace.read">>;
  save(input: OperationInput<"workspace.save">): Promise<OperationOutput<"workspace.save">>;
  format(input: OperationInput<"workspace.format">): Promise<OperationOutput<"workspace.format">>;
  search(input: OperationInput<"workspace.search">): Promise<OperationOutput<"workspace.search">>;
  blame(input: OperationInput<"workspace.blame">): Promise<OperationOutput<"workspace.blame">>;
  /**
   * Version control where a session runs, or where a new one would start.
   * Without a backend, reads answer empty and writes answer `failed`.
   */
  vcs: {
    snapshot(input: OperationInput<"workspace.vcs.snapshot">): Promise<VcsSnapshot>;
    diff(input: OperationInput<"workspace.vcs.diff">): Promise<readonly VcsDiff[]>;
    changes(input: OperationInput<"workspace.vcs.changes">): Promise<readonly VcsChange[]>;
    contents(input: OperationInput<"workspace.vcs.contents">): Promise<VcsContents>;
    log(input: OperationInput<"workspace.vcs.log">): Promise<VcsLog>;
    refs(input: OperationInput<"workspace.vcs.refs">): Promise<VcsRefs>;
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
  /** The default model's credential, proven with one non-generating provider request. */
  status(): Promise<ProviderAuthStatus>;
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

/** The prospective catalog has no plugins to list because the default workspace did not open. */
export class WorkspaceNotActive extends Error {
  readonly activation: Exclude<SessionActivationState, { readonly kind: "active" }>;

  constructor(activation: Exclude<SessionActivationState, { readonly kind: "active" }>) {
    super(describeInactive(activation));
    this.name = "WorkspaceNotActive";
    this.activation = activation;
  }
}

function describeInactive(
  activation: Exclude<SessionActivationState, { readonly kind: "active" }>,
): string {
  switch (activation.kind) {
    case "failed":
      return `The workspace's plugins failed to load: ${activation.error}`;
    case "inactive":
      return "The workspace is inactive";
    case "requires":
      return activation.requirement.kind === "workspace_trust"
        ? `Workspace trust is required for ${activation.requirement.cwd}`
        : `The workspace is ${activation.requirement.reason}`;
    default: {
      const _exhaustive: never = activation;

      return _exhaustive;
    }
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

/** The host's decision for one workspace, asked once when the SDK opens it. */
export type WorkspaceTrust =
  | {
      readonly kind: "trusted";
      /**
       * Plugins that live in the workspace, loaded once its environment is
       * open, again before each response, and again when `changes` fires. They
       * can wrap the environment, never provide one.
       */
      readonly plugins?: (env: ExecutionEnv) => Promise<readonly Plugin[]>;
      /** Tells every session active in the workspace that its plugin sources may have changed. */
      readonly changes?: (notify: () => void) => Disposer;
    }
  | { readonly kind: "inactive" }
  | { readonly kind: "requires"; readonly requirement: ActivationRequirement };

/**
 * How a host answers `trust` for a folder with no recorded decision. `ask`
 * reports `requires/workspace_trust` for a folder that carries project input
 * and trusts one that carries none; `always` trusts every folder with its
 * input; `never` trusts every folder and leaves its input unloaded, so nothing
 * ever asks. A user setting, never a project's: a folder cannot trust itself.
 */
export type WorkspaceTrustMode = "ask" | "always" | "never";

export interface NyteOptions {
  /** Receives converted summary failures once, before the public outcome is returned. */
  readonly onDiagnostic?: (diagnostic: SummaryDiagnostic) => void | Promise<void>;
  readonly store: Store;
  readonly streamFn: StreamFn;
  readonly models: ModelCatalog;
  readonly model: Model<Api>;
  /** How much of an inbox chain each step lands. */
  readonly drain?: Drain;
  readonly actor?: Actor;
  readonly thinkingLevel?: ThinkingLevel;
  readonly compaction?: CompactionSettings;
  readonly streamOptions?: StreamOptions;
  /** Read at every warming decision, so the host's policy may change while sessions run. Default: streaming. */
  readonly cacheWarming?: () => CacheWarmingMode;
  /** default: records nothing */
  readonly telemetry?: TelemetryContext;
  readonly workspace?: WorkspaceBackend;
  /**
   * Host-only. The directory a `registered` workspace target names, when the
   * host's registry knows the id and the folder may be served; `undefined`
   * otherwise, and the target then names nothing. Absent on hosts without a
   * registry.
   */
  readonly registeredWorkspace?: (id: string) => Promise<string | undefined>;
  /**
   * Installed when the SDK is created; every session runs these plugins, then
   * its workspace's project plugins. Their `environment` providers open
   * workspaces. `createNyte` throws if two provide one kind, or none provides
   * `defaultWorkspace.kind`.
   */
  readonly plugins: readonly Plugin[];
  /** Where a root session acts when `sessions.create` names no workspace. */
  readonly defaultWorkspace: Workspace;
  /** Decides each workspace once, before its provider is reached. Default: trusted for `defaultWorkspace`, `requires/workspace_trust` for any other. */
  readonly trust?: (workspace: Workspace) => WorkspaceTrust | Promise<WorkspaceTrust>;
}

export type RelocateOutcome =
  | { readonly kind: "relocated" }
  | { readonly kind: "busy" }
  | Exclude<SessionActivationState, { readonly kind: "active" }>;

/** Without `verifyAuth`, `provider.status` can only tell a configured credential from a missing one. */
export type ModelCatalog = Pick<Models, "getModels" | "getModel" | "getAvailable"> &
  Partial<Pick<Models, "verifyAuth">>;

export interface CacheWarming {
  status(input: { readonly sessionId: SessionId; readonly head?: HeadName }): CacheWarmingStatus;
  /** Reconcile every active warming run after `cacheWarming()` starts answering differently. */
  modeChanged(): void;
}

export interface Nyte {
  readonly sessions: Sessions;
  readonly messages: Messages;
  readonly runs: Runs;
  readonly jobs: Jobs;
  readonly heads: Heads;
  readonly workspace: WorkspaceApi;
  readonly provider: Provider;
  readonly plugins: Plugins;
  readonly cacheWarming: CacheWarming;
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
  /**
   * Host-only location read. Returns the tree's directory while it is active in
   * the environment the host's workspace backend reads, and `undefined`
   * otherwise. A saved path is not a trust grant.
   */
  sessionCwd(input: { readonly sessionId: SessionId }): Promise<string | undefined>;
  /**
   * Host-only read of the tree's root and its workspace, locator included,
   * without reading history. `undefined` once the session or an ancestor is
   * gone; stored parents that form a cycle throw.
   */
  sessionRoot(input: { readonly sessionId: SessionId }): Promise<SessionRoot | undefined>;
  /**
   * Move an idle session tree to another workspace, opened as any workspace
   * opens: a child moves its root. Store and history stay.
   */
  relocate(input: {
    readonly sessionId: SessionId;
    readonly workspace: Workspace;
  }): Promise<RelocateOutcome>;
  close(): Promise<void>;
}
