import type {
  MentionFile,
  WorkspaceFileDocument,
  WorkspaceFileSaveOutcome,
} from "@nyte-ai/protocol";
/**
 * The wire between the Electron main host and the renderer client.
 *
 * The SDK is already wire-shaped (design record, "The SDK"), so the mapping is
 * mechanical: one operation path per SDK operation, the operation's single input object as the
 * payload, its receipt or outcome union as the response. `watch` is the one
 * transport adaptation: an AsyncIterable cannot cross IPC, so it becomes a
 * start/stop pair around a push channel, cursor semantics unchanged.
 */
import type {
  Landing,
  RemoteNyte,
  Seq,
  SessionEvent,
  SessionId,
  SessionInfo,
  WorkspaceInfo,
  VcsDiff,
  VcsStatus,
} from "@nyte-ai/protocol";
import type { UsageSubject } from "@nyte-ai/client";
import type { ModelThinkingLevel } from "@nyte-ai/schema";
import type { AccountUsage, ClaudeCodeUsage, CodexUsage } from "@nyte-ai/host/usage";
import type { ModelInfo, Operation, ServerInfo } from "@nyte-ai/protocol";
import type { AppMenuCommand } from "./app-menu.ts";
import type { WorkspaceEditorBridge } from "./workspace-editor.ts";
import type { IpcFailure, IpcResult } from "./errors.ts";

type Disposer = () => void;

/** Editor work is cancellable and owned by the window, rather than a session host. */
export const WORKSPACE_EDITOR_CHANNEL = "nyte:workspace-editor";
export type WorkspaceEditorOperation = keyof WorkspaceEditorBridge;
export type WorkspaceEditorInput<P extends WorkspaceEditorOperation> = Parameters<
  WorkspaceEditorBridge[P]
>[0];
export type WorkspaceEditorOutput<P extends WorkspaceEditorOperation> = Awaited<
  ReturnType<WorkspaceEditorBridge[P]>
>;
export type WorkspaceEditorRequest = {
  [P in WorkspaceEditorOperation]: {
    readonly operation: P;
    readonly input: WorkspaceEditorInput<P>;
  };
}[WorkspaceEditorOperation];
export type WorkspaceEditorReply<P extends WorkspaceEditorOperation> = IpcResult<
  WorkspaceEditorOutput<P>
>;

export const CALL_CHANNEL = "nyte:call";
export const WATCH_START_CHANNEL = "nyte:watch-start";
export const WATCH_STOP_CHANNEL = "nyte:watch-stop";
export const WATCH_EVENT_CHANNEL = "nyte:watch-event";
export const HOST_EVENT_CHANNEL = "nyte:host-event";
export const THEME_PREFERENCE_CHANNEL = "nyte:theme-preference";
export const BROWSER_BOUNDS_CHANNEL = "nyte:browser-bounds";

export type ThemePreference = "system" | "light" | "dark";

/** Every SDK operation the bridge carries, one path per operation. Each is a wire-protocol operation. */
export const SDK_OPERATION_PATHS = [
  "sessions.create",
  "sessions.get",
  "sessions.snapshot",
  "sessions.metadata",
  "sessions.list",
  "sessions.rename",
  "sessions.setPinned",
  "sessions.setArchived",
  "sessions.delete",
  "sessions.configure",
  "messages.send",
  "messages.cancel",
  "messages.redeliver",
  "jobs.list",
  "jobs.start",
  "jobs.background",
  "jobs.cancel",
  "runs.abort",
  "runs.reply",
  "heads.move",
  "workspace.list",
  "workspace.forget",
  "workspace.vcs.diff",
  "provider.models.default",
  "plugins.catalog",
  "plugins.list",
  "plugins.commands.list",
  "plugins.commands.run",
  "plugins.settings.list",
  "plugins.settings.apply",
  "plugins.resources.list",
] as const satisfies readonly Operation[];

export type SdkOperationPath = (typeof SDK_OPERATION_PATHS)[number];

/** Host operations beside the SDK: workspace lifecycle and provider auth. */
export const HOST_OPERATION_PATHS = [
  "host.state",
  "host.sessionDirectory",
  "host.fonts",
  "host.openWorkspace",
  "host.pickWorkspace",
  "host.trustWorkspace",
  "host.closeWorkspace",
  "host.catalog",
  "host.usage",
  "host.accountLimits",
  "host.login",
  "host.cancelLogin",
  "host.logout",
  "host.setPreference",
  "host.vcs.snapshot",
  "host.vcs.contents",
  "host.vcs.diff",
  "host.vcs.log",
  "host.vcs.refs",
  "host.vcs.revert",
  "host.vcs.stage",
  "host.vcs.commit",
  "host.vcs.createBranch",
  "host.vcs.push",
  "host.vcs.createPullRequest",
  "host.files.list",
  "host.files.cancelList",
  "host.files.read",
  "host.files.save",
  "host.github.state",
  "host.github.signIn",
  "host.github.signOut",
  "host.server.state",
  "host.server.connect",
  "host.server.disconnect",
  "host.server.createSession",
  "host.mobile.state",
  "host.mobile.start",
  "host.mobile.stop",
  "host.openExternal",
  "host.revealPath",
  "host.contextMenu",
  "host.browser.open",
  "host.browser.navigate",
  "host.browser.menu",
  "host.browser.perform",
  "host.browser.close",
  "host.browser.captureFrame",
  "host.terminal.create",
  "host.terminal.write",
  "host.terminal.resize",
  "host.terminal.acknowledge",
  "host.terminal.idle",
  "host.terminal.close",
] as const;

export type HostOperationPath = (typeof HOST_OPERATION_PATHS)[number];

export type CallPath = SdkOperationPath | HostOperationPath;

export interface WatchStartInput {
  readonly watchId: string;
  readonly sessionId: SessionId;
  /** Replay from this cursor. Omitted with `live` unset replays from the start. */
  readonly afterSeq?: Seq;
  /** Skip replay and start at the tip; `synced` still arrives first. */
  readonly live?: boolean;
}

export type WatchEnvelope =
  | { readonly watchId: string; readonly kind: "event"; readonly event: SessionEvent }
  | { readonly watchId: string; readonly kind: "ended"; readonly error?: IpcFailure };

// ---------------------------------------------------------------------------
// host types
// ---------------------------------------------------------------------------

/** Sessions live in a local store (Home or a folder) or on the configured server. */
export type WorkspaceSessionDirectory =
  | {
      readonly environment: "local";
      readonly workspacePath: string | null;
      readonly sessions: readonly SessionInfo[];
    }
  | {
      readonly environment: "cloud";
      readonly sessions: readonly SessionInfo[];
      readonly availability:
        | { readonly kind: "ready" }
        | { readonly kind: "unavailable"; readonly message: string };
    };

/** The sessions of one local store: `null` is Home. */
export function localSessions(
  directories: readonly WorkspaceSessionDirectory[],
  workspacePath: string | null,
): readonly SessionInfo[] | undefined {
  return directories.find(
    (directory) => directory.environment === "local" && directory.workspacePath === workspacePath,
  )?.sessions;
}

/** The sessions of the connected server, if one is configured. */
export function cloudSessions(
  directories: readonly WorkspaceSessionDirectory[],
): readonly SessionInfo[] | undefined {
  return directories.find((directory) => directory.environment === "cloud")?.sessions;
}

/** The server the desktop reaches, without its token; the renderer never reads that back. */
export type ServerState =
  | { readonly kind: "none" }
  | { readonly kind: "connected"; readonly baseUrl: string; readonly info: ServerInfo }
  | {
      readonly kind: "unavailable";
      readonly baseUrl: string;
      readonly problem: ServerConnectionProblem;
    };

export interface ServerConnectionProblem {
  readonly kind: "authentication" | "network" | "incompatible" | "server";
  readonly message: string;
}

export type ServerConnectOutcome =
  | { readonly kind: "connected"; readonly baseUrl: string; readonly version: string }
  | { readonly kind: "failed"; readonly message: string };

/**
 * How far a share reaches. `simulator` binds loopback, so only a simulator on
 * this Mac can open it. `tailnet` binds this machine's Tailscale address, so
 * the user's own signed-in devices reach it over cellular or any network,
 * and nothing on the local wifi can.
 */
export type MobileShareReach = "simulator" | "tailnet";

/** Why a tailnet share is not offered, so the UI can say what to fix. */
export type TailnetAvailability =
  | { readonly kind: "ready"; readonly ip: string; readonly name: string | undefined }
  | { readonly kind: "unavailable"; readonly state: string }
  | { readonly kind: "missing" };

/**
 * The local store this desktop is serving to the iOS app. The share starts on
 * the target selected when sharing began; the phone's `workspace.select` moves
 * it afterwards without touching the Mac's own selection. The token lives for
 * this share alone; stopping discards it.
 */
export type MobileShareState =
  | { readonly kind: "off"; readonly tailnet: TailnetAvailability }
  | {
      readonly kind: "sharing";
      readonly address: string;
      readonly token: string;
      readonly reach: MobileShareReach;
      readonly target:
        | { readonly kind: "home" }
        | { readonly kind: "project"; readonly workspace: WorkspaceInfo };
    };

export interface HostState {
  /** Absent selects the id-only Home target, not the operating-system home folder. */
  readonly workspace: WorkspaceInfo | undefined;
  readonly platform: NodeJS.Platform;
}

export type { WorkspaceFileDocument, WorkspaceFileSaveOutcome } from "@nyte-ai/protocol";

/** CSS family names discovered by the native host; font-file paths never cross IPC. */
export interface LocalFontCatalog {
  readonly sans: readonly string[];
  readonly monospace: readonly string[];
}

export type OpenWorkspaceOutcome =
  | { kind: "opened"; workspace: WorkspaceInfo }
  | { kind: "needs_trust"; path: string }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

/** A way to connect a provider from the desktop. */
export type SignInMethod =
  | { readonly kind: "browser"; readonly label: string; readonly subscription: string }
  | { readonly kind: "api_key"; readonly label: string };

/**
 * What a running sign-in shows while the provider's flow waits on the user.
 * Device codes and their instructions stay until the attempt ends; messages
 * are the latest word from the flow and never replace a code. The device
 * secret never leaves main.
 */
export type LoginProgress =
  | {
      readonly kind: "device_code";
      readonly userCode: string;
      readonly verificationUri: string;
      readonly expiresInSeconds: number | undefined;
      readonly instructions: string | undefined;
    }
  | { readonly kind: "message"; readonly message: string };

/**
 * How a sign-in ended without failing. A saved credential is a connection even
 * when the provider's model list could not be fetched afterwards; what the
 * picker then shows for the provider is up to the provider's catalog, which
 * may be empty for an account-specific list until a later refresh succeeds.
 */
export type LoginOutcome =
  | { readonly kind: "connected"; readonly catalogRefreshed: boolean }
  | { readonly kind: "cancelled" };

export interface ProviderStatus {
  readonly id: string;
  readonly name: string;
  /** Off keeps the provider's models out of the picker and out of the default. */
  readonly enabled: boolean;
  /** `env` names the variable when the key came from the environment rather than the store. */
  readonly connection:
    | { readonly kind: "disconnected" }
    | { readonly kind: "server" }
    | { readonly kind: "oauth" }
    | { readonly kind: "api_key"; readonly env: string | undefined };
  readonly signIn: readonly SignInMethod[];
}

/**
 * Where the checkout stands relative to its branch and upstream. `oid` is
 * `null` on an unborn HEAD, where a branch name already exists but points at
 * no commit. A detached HEAD carries an `oid` and no branch.
 */
export interface DesktopVcsHead {
  readonly oid: string | null;
  readonly branch?: string;
  /** Short upstream ref (`origin/main`) when the branch tracks one. */
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
}

/**
 * Desktop-local repository identity and cache revision. Core remains
 * provider-neutral. `status` stays the whole-tree view; `staged` and
 * `unstaged` split the same records by the index and worktree status columns,
 * so one file can appear in both with different kinds. The git backend always
 * answers with all three; they are optional for callers that construct a
 * snapshot from the status alone.
 */
export type DesktopVcsSnapshot =
  | {
      readonly kind: "not_repository";
      readonly repositoryId: string;
      readonly revision: "not-repository";
      readonly status: VcsStatus;
      readonly head?: DesktopVcsHead;
      readonly staged?: VcsStatus["files"];
      readonly unstaged?: VcsStatus["files"];
    }
  | {
      readonly kind: "repository";
      readonly repositoryId: string;
      readonly revision: string;
      readonly status: VcsStatus;
      readonly head?: DesktopVcsHead;
      readonly staged?: VcsStatus["files"];
      readonly unstaged?: VcsStatus["files"];
    };

/** What the desktop git backend answers with: the split and head are always read. */
export type DesktopGitSnapshot = DesktopVcsSnapshot & {
  readonly head: DesktopVcsHead;
  readonly staged: VcsStatus["files"];
  readonly unstaged: VcsStatus["files"];
};

/**
 * Which comparison a diff read asks for. `worktree` is everything since the
 * last commit, staged or not; `staged` is the index against HEAD; `unstaged`
 * is the worktree against the index; `commit` is one commit against its parent.
 */
export type DesktopVcsDiffScope = "worktree" | "staged" | "unstaged" | "commit";

export interface DesktopVcsDiffInput {
  readonly scope: DesktopVcsDiffScope;
  /** Required by the `commit` scope and ignored by every other one. */
  readonly commit?: string;
  /** Narrow the read to these workspace-relative paths. */
  readonly paths?: readonly string[];
  readonly ignoreWhitespace?: boolean;
}

export interface DesktopVcsCommit {
  readonly oid: string;
  readonly shortOid: string;
  readonly subject: string;
  readonly author: string;
  /** Commit time in epoch milliseconds. */
  readonly committedAt: number;
}

/** One page of history. `hasMore` is read from one extra commit, not a count. */
export interface DesktopVcsLog {
  readonly commits: readonly DesktopVcsCommit[];
  readonly hasMore: boolean;
}

export interface DesktopVcsLogInput {
  readonly limit: number;
  /** Continue strictly older than this commit; omitted starts at HEAD. */
  readonly before?: string;
}

/** Short ref names. `current` is absent on a detached HEAD. */
export interface DesktopVcsRefs {
  readonly current?: string;
  readonly local: readonly string[];
  readonly remote: readonly string[];
}

export interface DesktopVcsRevertInput {
  /** Workspace-relative paths to discard, each checked against the workspace root. */
  readonly paths: readonly string[];
}

/** Why one path was left alone. A path with nothing to revert is reported here, never as a failure. */
export interface DesktopVcsRevertSkip {
  readonly path: string;
  readonly reason: string;
}

/**
 * What a revert did, path by path. Tracked files are restored from HEAD in
 * both the index and the worktree; untracked files are moved to the OS trash,
 * so an untracked revert is recoverable outside Nyte.
 */
export interface DesktopVcsRevert {
  readonly reverted: readonly string[];
  readonly skipped: readonly DesktopVcsRevertSkip[];
}

export interface DesktopVcsStageInput {
  /** Workspace-relative paths, each checked against the workspace root. */
  readonly paths: readonly string[];
  /** `true` adds the path to the index, `false` removes it from the index. */
  readonly staged: boolean;
}

/** Why one path's index entry was left alone, in git's own words. */
export interface DesktopVcsStageSkip {
  readonly path: string;
  readonly reason: string;
}

/**
 * What a stage change did, path by path. `staged` lists the paths that now
 * match the request, whether they were added to or removed from the index. A
 * path git refused is reported in `skipped`, and the rest of the batch applies.
 */
export interface DesktopVcsStage {
  readonly staged: readonly string[];
  readonly skipped: readonly DesktopVcsStageSkip[];
}

export interface DesktopVcsCommitInput {
  /** Passed to git as an argument. A whitespace-only message is refused before git runs. */
  readonly message: string;
  /** Commit every tracked change, staged or not. */
  readonly all?: boolean;
  /** Commit only these workspace-relative paths. */
  readonly paths?: readonly string[];
}

/**
 * `failed` carries git's own first line: a rejected hook, a signing or identity
 * problem, and an unresolved conflict all land here rather than throwing.
 */
export type DesktopVcsCommitResult =
  | {
      readonly kind: "committed";
      readonly oid: string;
      readonly shortOid: string;
      readonly summary: string;
    }
  | { readonly kind: "nothing_to_commit" }
  | { readonly kind: "failed"; readonly reason: string };

export interface DesktopVcsCreateBranchInput {
  readonly name: string;
  /** Move HEAD to the new branch instead of only creating it. */
  readonly checkout: boolean;
}

/** `invalid_name` is `git check-ref-format`'s verdict, not a local guess. */
export type DesktopVcsCreateBranch =
  | { readonly kind: "created" }
  | { readonly kind: "exists" }
  | { readonly kind: "invalid_name"; readonly reason?: string }
  | { readonly kind: "failed"; readonly reason: string };

export interface DesktopVcsPushInput {
  /**
   * Publish a branch that tracks nothing, against the single configured
   * remote. Without it an untracked branch answers `no_upstream`.
   */
  readonly setUpstream?: boolean;
}

/**
 * A push is never forced and never runs on a detached HEAD, which answers
 * `failed`. `rejected` is the remote refusing a non-fast-forward update, so
 * the branch needs a pull first.
 */
export type DesktopVcsPush =
  | {
      readonly kind: "pushed";
      readonly remote: string;
      readonly branch: string;
    }
  | { readonly kind: "up_to_date"; readonly remote?: string; readonly branch?: string }
  | { readonly kind: "no_upstream"; readonly branch: string }
  | { readonly kind: "rejected"; readonly reason: string; readonly branch?: string }
  | { readonly kind: "failed"; readonly reason: string; readonly branch?: string };

export interface DesktopVcsPullRequestInput {
  readonly title: string;
  readonly body?: string;
  readonly draft?: boolean;
}

/**
 * Every state `gh` can leave a pull request request in. `exists` carries the
 * pull request already open for this branch; nothing is created then.
 */
export type DesktopVcsPullRequestResult =
  | { readonly kind: "created"; readonly url: string }
  | { readonly kind: "exists"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "cli_missing" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "no_remote" }
  | { readonly kind: "failed"; readonly message: string };

/** Which side a diff was computed against: the last commit or the staged index. */
export type DesktopVcsBase = "head" | "index";

export interface DesktopVcsContentsInput {
  readonly path: string;
  readonly base: DesktopVcsBase;
}

/**
 * Both sides of one file, so a partial patch can be rendered with full context.
 * A side is `null` when the file does not exist there: `old` for added or
 * untracked files, `new` for deleted ones. Binary files report no contents.
 */
export interface DesktopVcsContents {
  readonly path: string;
  readonly old: { readonly contents: string } | null;
  readonly new: { readonly contents: string } | null;
  readonly binary: boolean;
  readonly truncated: boolean;
}

export interface GitHubRepository {
  readonly owner: string;
  readonly name: string;
  readonly remoteName: string;
  /** Canonical public URL. Remote credentials and raw remote URLs never cross IPC. */
  readonly url: string;
}

export interface GitHubAccount {
  readonly login: string;
  readonly name: string | undefined;
  readonly avatarUrl: string | undefined;
}

export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly draft: boolean;
  readonly headRefName: string;
  readonly baseRefName: string;
}

export type GitHubPullRequestContext =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "error"; readonly message: string };

/** GitHub is optional enrichment; no variant changes local VCS availability. */
export type GitHubProviderState =
  | { readonly kind: "cli_missing"; readonly repository: GitHubRepository | undefined }
  | { readonly kind: "signed_out"; readonly repository: GitHubRepository | undefined }
  | {
      readonly kind: "ready";
      readonly repository: GitHubRepository | undefined;
      readonly account: GitHubAccount;
      readonly pullRequest: GitHubPullRequestContext;
    }
  | {
      readonly kind: "error";
      readonly repository: GitHubRepository | undefined;
      readonly message: string;
    };

export interface DesktopModelOption extends ModelInfo {
  readonly key: string;
  readonly fastMode:
    | { readonly kind: "unavailable" }
    | { readonly kind: "available"; readonly settingId: string };
  /** Switched off in Settings › Models. */
  readonly hidden: boolean;
  /** In the picker: the provider is on and connected, and the model is not hidden. */
  readonly listed: boolean;
}

/** Everything the picker and Settings › Models draw from, read in one call. */
export interface DesktopCatalog {
  readonly source: "local" | "server";
  readonly providers: readonly ProviderStatus[];
  readonly models: readonly DesktopModelOption[];
  /** What a new chat starts with. */
  readonly defaults: {
    readonly model: { readonly provider: string; readonly id: string };
    readonly thinkingLevel: ModelThinkingLevel;
  };
}

export type PreferenceChange =
  | { readonly kind: "provider"; readonly provider: string; readonly enabled: boolean }
  | {
      readonly kind: "models";
      readonly provider: string;
      readonly ids: readonly string[];
      readonly hidden: boolean;
    }
  | {
      readonly kind: "defaults";
      readonly model?: { readonly provider: string; readonly id: string };
      readonly thinkingLevel?: ModelThinkingLevel;
    };

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------

/**
 * Recorded token counts and execution-time API cost estimates. Reasoning and
 * cache TTL subcounts overlap their owning buckets and are never added twice.
 */
export interface UsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Part of `output`, reported only by providers that split reasoning out. */
  readonly reasoning: number;
  readonly tokens: number;
  /** API-equivalent dollars, not subscription charges. */
  readonly cost: number;
  /** Usage-bearing commits, including compaction and tools, not user turns. */
  readonly turns: number;
}

export type { UsageSubject } from "@nyte-ai/client";
export type { AccountUsage } from "@nyte-ai/host/usage";

/**
 * The window a report covers, in the host's own local days. `sinceDay` is
 * `null` for all time, which is the one window whose start the caller cannot
 * name before reading.
 */
export interface UsageWindow {
  /** `YYYY-MM-DD`, inclusive, or `null` for every retained day. */
  readonly sinceDay: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  readonly untilDay: string;
}

/**
 * One cell of the report: everything the page groups by is a field here, so
 * every card is the same window summed along a different axis. Totals live
 * only on cells, which is what keeps two cards from disagreeing.
 */
export interface UsageEntry {
  /** `YYYY-MM-DD` in the host's own time zone, which is the renderer's too. */
  readonly day: string;
  readonly workspacePath: string | null;
  readonly sessionId: SessionId;
  readonly subject: UsageSubject;
  readonly totals: UsageTotals;
}

/**
 * Names for the sessions the entries reference. Identity only: a chat's spend
 * is summed from its cells, so it is windowed like everything else.
 */
export interface UsageSession {
  readonly sessionId: SessionId;
  readonly name: string | undefined;
  readonly workspacePath: string | null;
  readonly lastActivityAt: number;
}

/**
 * How one store's read went. A store that fails is a row on the page rather
 * than an error screen: the windows that did answer are still worth showing.
 */
export interface UsageSource {
  readonly workspacePath: string | null;
  readonly status: "ok" | "failed";
  /** Sessions read from this store, whether or not they spent in the window. */
  readonly sessions: number;
  readonly message: string | null;
}

/** One window of retained usage in registered desktop stores, folded once per read. */
export interface UsageReport {
  readonly readAt: number;
  /** The resolved window. For an all-time read `sinceDay` is the earliest day. */
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly entries: readonly UsageEntry[];
  readonly sessions: readonly UsageSession[];
  readonly sources: readonly UsageSource[];
  /**
   * Cost and tokens for the equal-length window immediately before this one.
   * Undefined when the read covers all time, or when nothing was retained
   * that far back, since neither has a rate of change to report.
   */
  readonly previous: { readonly cost: number; readonly tokens: number } | undefined;
  /**
   * Earliest retained day in any store, so an empty window can tell the reader
   * where the data actually starts instead of looking like a broken feature.
   */
  readonly earliestDay: string | undefined;
}

/**
 * One read with independent scopes. Claude Code and Codex are read from their
 * own local history and never contribute desktop cells or chats; both readers
 * fold whole histories, so their totals are all-time regardless of the window.
 */
export interface UsageSnapshot extends UsageReport {
  /** A report-wide Nyte read failure, distinct from individual failed stores. */
  readonly nyteError: string | null;
  readonly claudeCode: ClaudeCodeUsage;
  readonly codex: CodexUsage;
}

// ---------------------------------------------------------------------------
// browser surfaces
// ---------------------------------------------------------------------------

/** One embedded page. The surface id is the workbench view key. */
export interface BrowserSurfaceState {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly secure: "https" | "http" | "none";
  /** False when no filter lists are bundled in this build. */
  readonly blocking: boolean;
  /** Requests blocked since the current page started loading. */
  readonly blocked: number;
  readonly error: { readonly code: number; readonly description: string } | undefined;
  /** Number of agent (session) holders currently retaining this surface. */
  readonly agentHolders: number;
}

export const BROWSER_ACTIONS = [
  "screenshot",
  "hard-reload",
  "copy-url",
  "clear-history",
  "clear-cookies",
  "clear-cache",
] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];
export type BrowserMenuAction = BrowserAction | "toggle-bookmarks";

export type BrowserNavigationAction = "back" | "forward" | "reload" | "stop";

/**
 * Clipboard and selection roles run in the focused web contents, so a native
 * paste keeps the formats a renderer-side clipboard read cannot reach.
 */
export const CONTEXT_MENU_ROLES = ["cut", "copy", "paste", "selectAll"] as const;
export type ContextMenuRole = (typeof CONTEXT_MENU_ROLES)[number];

export type ContextMenuTemplateItem =
  | { readonly kind: "separator" }
  | { readonly kind: "role"; readonly role: ContextMenuRole; readonly label: string }
  | {
      readonly kind: "item";
      readonly label: string;
      /** Electron accelerator shown right-aligned; it is display only here. */
      readonly accelerator?: string;
      readonly enabled?: boolean;
    };

export interface BrowserBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserBoundsMessage {
  readonly surface: string;
  readonly bounds: BrowserBounds;
  readonly visible: boolean;
}

export interface TerminalInfo {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
}

export type HostEvent =
  | { kind: "terminal_data"; id: string; data: string }
  | { kind: "terminal_exit"; id: string; exitCode: number }
  | { kind: "workspace_opened"; workspace: WorkspaceInfo }
  /** A host mutation (file save, terminal) was refused. Sessions report trust through their activation. */
  | { kind: "workspace_trust_required"; path: string }
  | { kind: "workspace_closed" }
  /** A sign-in, sign-out, or preference change; re-read the catalog. */
  | { kind: "catalog_changed" }
  | { kind: "github_changed" }
  /** A running sign-in has something to show. `attempt` is the ID the renderer chose for it. */
  | { kind: "login_progress"; attempt: string; provider: string; progress: LoginProgress }
  /** The server was connected or disconnected; re-read its state and the directory. */
  | { kind: "server_changed" }
  /** Sharing with the iOS app started or stopped; re-read its state. */
  | { kind: "mobile_share_changed" }
  | { kind: "status"; message: string }
  | { kind: "browser_changed"; surface: string; state: BrowserSurfaceState }
  | { kind: "browser_download_refused"; surface: string; url: string }
  | {
      kind: "browser_agent_opened";
      surface: string;
      url: string;
      state: BrowserSurfaceState;
    };

// ---------------------------------------------------------------------------
// the renderer-facing bridge, the SDK interfaces verbatim
// ---------------------------------------------------------------------------

export type SessionsBridge = Pick<
  RemoteNyte["sessions"],
  | "create"
  | "get"
  | "snapshot"
  | "metadata"
  | "list"
  | "rename"
  | "setPinned"
  | "setArchived"
  | "delete"
  | "configure"
>;

export type MessagesBridge = Pick<RemoteNyte["messages"], "send" | "cancel" | "redeliver">;

export type RunsBridge = Pick<RemoteNyte["runs"], "abort" | "reply">;

export type HeadsBridge = Pick<RemoteNyte["heads"], "move">;

/** `workspace.list` and `workspace.forget` answer from the registry even when no workspace is open. */
export type WorkspaceBridge = Pick<RemoteNyte["workspace"], "list" | "forget"> & {
  readonly vcs: Pick<RemoteNyte["workspace"]["vcs"], "diff">;
};

export type ProviderBridge = {
  readonly models: Pick<RemoteNyte["provider"]["models"], "default">;
};

export type PluginsBridge = Pick<RemoteNyte["plugins"], "catalog" | "list"> & {
  readonly commands: Pick<RemoteNyte["plugins"]["commands"], "list" | "run">;
  readonly settings: Pick<RemoteNyte["plugins"]["settings"], "list" | "apply">;
  readonly resources: Pick<RemoteNyte["plugins"]["resources"], "list">;
};

export type WatchInput =
  | { sessionId: SessionId; afterSeq?: Seq }
  | { sessionId: SessionId; live: true };

export interface HostBridge {
  /** Subscribe before main delivers a menu action that reopened the window. */
  onMenuCommand(listener: (command: AppMenuCommand) => void): Disposer;
  /** Keep Electron's native material and controls in the renderer's appearance mode. */
  setThemePreference(preference: ThemePreference): void;
  state(): Promise<HostState>;
  sessionDirectory(): Promise<readonly WorkspaceSessionDirectory[]>;
  /** Installed UI and fixed-pitch families, discovered without renderer font permissions. */
  fonts(): Promise<LocalFontCatalog>;
  /** Select local history by path, even when the folder is unavailable. */
  openWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  /** Native folder picker, then open. */
  pickWorkspace(): Promise<OpenWorkspaceOutcome>;
  /** Grant trust and open in one step; the renderer's trust dialog confirms first. */
  trustWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  closeWorkspace(): Promise<void>;
  /** A session reads its owning host's catalog. Omit the input for local provider settings. */
  catalog(input?: { readonly sessionId: SessionId }): Promise<DesktopCatalog>;
  /**
   * Fold retained history from Home and registered desktop workspace stores
   * for one window. The window is the request, not a client-side slice, so
   * desktop figures are scoped to the same days. Claude Code is a separate
   * all-time local-history snapshot, independent of this window.
   */
  usage(input: UsageWindow): Promise<UsageSnapshot>;
  /**
   * The subscription windows the signed-in Anthropic and OpenAI accounts
   * report. This is the only usage read that leaves the machine, so the page
   * asks for it once per visit and never on a timer.
   */
  accountLimits(): Promise<readonly AccountUsage[]>;
  /**
   * Browser sign-in needs a user gesture. An API key crosses IPC once and is
   * never read back; the provider's own login flow stores it. `attempt` is a
   * renderer-chosen ID that correlates progress events and a later cancel with
   * this call; a new attempt for the same provider cancels the previous one
   * and starts once that one has settled. An ID stays taken until its attempt
   * has settled, so reusing one that was just cancelled is refused.
   */
  login(input: {
    provider: string;
    method: { kind: "browser" } | { kind: "api_key"; key: string };
    attempt: string;
  }): Promise<LoginOutcome>;
  /** Stop a running sign-in. An attempt that already ended is a no-op. */
  cancelLogin(input: { attempt: string }): Promise<void>;
  logout(input: { provider: string }): Promise<void>;
  /** Apply one preference change and answer with the catalog as it now stands. */
  setPreference(change: PreferenceChange): Promise<DesktopCatalog>;
  vcs: {
    /** Revision is desktop cache identity; status still comes from the generic VCS backend. */
    snapshot(): Promise<DesktopVcsSnapshot>;
    /** Read-only both-sides file read that hydrates a partial patch with full file context. */
    contents(input: DesktopVcsContentsInput): Promise<DesktopVcsContents>;
    /** One patch per changed file in the requested scope; unchanged files are omitted. */
    diff(input: DesktopVcsDiffInput): Promise<readonly VcsDiff[]>;
    /** A page of history, newest first. An unborn HEAD has no commits. */
    log(input: DesktopVcsLogInput): Promise<DesktopVcsLog>;
    refs(): Promise<DesktopVcsRefs>;
    /**
     * Discard each path's working-tree state: tracked files go back to HEAD,
     * untracked files go to the OS trash. Needs workspace trust, like every
     * other host mutation.
     */
    revert(input: DesktopVcsRevertInput): Promise<DesktopVcsRevert>;
    /** Add each path to the index or remove it from the index. Needs workspace trust. */
    stage(input: DesktopVcsStageInput): Promise<DesktopVcsStage>;
    /**
     * Commit the index, or the named paths, or every tracked change with
     * `all`. Hook, signing, identity, and conflict failures answer `failed`
     * instead of throwing. Needs workspace trust.
     */
    commit(input: DesktopVcsCommitInput): Promise<DesktopVcsCommitResult>;
    /** Create a branch, optionally checking it out. Needs workspace trust. */
    createBranch(input: DesktopVcsCreateBranchInput): Promise<DesktopVcsCreateBranch>;
    /** Push the current branch. Never forced, never from a detached HEAD. Needs workspace trust. */
    push(input: DesktopVcsPushInput): Promise<DesktopVcsPush>;
    /** Open a pull request for the current branch through `gh`. Needs workspace trust. */
    createPullRequest(input: DesktopVcsPullRequestInput): Promise<DesktopVcsPullRequestResult>;
  };
  files: WorkspaceEditorBridge & {
    /** Files and their parent folders offered for `@` mentions. */
    list(input: { requestId: string }): Promise<readonly MentionFile[]>;
    cancelList(input: { requestId: string }): Promise<void>;
    read(input: { path: string }): Promise<WorkspaceFileDocument>;
    save(input: {
      path: string;
      contents: string;
      version: string;
    }): Promise<WorkspaceFileSaveOutcome>;
  };
  github: {
    state(): Promise<GitHubProviderState>;
    /** The renderer can call this only from a user gesture. `gh` owns the credentials. */
    signIn(): Promise<GitHubProviderState>;
    signOut(): Promise<GitHubProviderState>;
  };
  server: {
    state(): Promise<ServerState>;
    /** Proves the server answers with this token before remembering either. */
    connect(input: { baseUrl: string; token: string }): Promise<ServerConnectOutcome>;
    disconnect(): Promise<void>;
    /** A new chat on the server; the desktop's selected folder does not change. */
    createSession(): Promise<SessionInfo>;
  };
  mobile: {
    state(): Promise<MobileShareState>;
    /** Serve the selected local target; a later folder change does not move the share. */
    start(input: { reach: MobileShareReach }): Promise<MobileShareState>;
    /** Close the listener and its streams. Work a session already accepted continues. */
    stop(): Promise<void>;
  };
  openExternal(input: { url: string }): Promise<void>;
  /** Show a file or folder in the system file manager. */
  revealPath(input: { path: string }): Promise<void>;
  /**
   * Pop a native context menu at the cursor and resolve the chosen item's index
   * in `items`, or undefined when it is dismissed. Native menus float above the
   * `WebContentsView`s that browser panels composite over the renderer.
   */
  contextMenu(input: {
    items: readonly ContextMenuTemplateItem[];
    x: number;
    y: number;
  }): Promise<number | undefined>;
  terminal: {
    create(input: { id: string; workspacePath: string | null }): Promise<TerminalInfo>;
    write(input: { id: string; data: string }): Promise<void>;
    resize(input: { id: string; cols: number; rows: number }): Promise<void>;
    acknowledge(input: { id: string; length: number }): Promise<void>;
    /** True only when the host can see the shell prompt idle, so closing needs no confirmation. */
    idle(input: { id: string }): Promise<boolean>;
    close(input: { id: string }): Promise<void>;
  };
  browser: {
    open(input: {
      surface: string;
      url: string;
      owner?: { kind: "home" } | { kind: "project"; path: string };
    }): Promise<BrowserSurfaceState>;
    navigate(input: { surface: string; action: BrowserNavigationAction }): Promise<void>;
    menu(input: {
      surface: string;
      bookmarksVisible: boolean;
      x: number;
      y: number;
    }): Promise<BrowserMenuAction | undefined>;
    perform(input: { surface: string; action: BrowserAction }): Promise<void>;
    close(input: { surface: string }): Promise<void>;
    /**
     * The page's current pixels as a data URL, captured without showing the
     * view. The panel paints it while an overlay forces the page to hide.
     */
    captureFrame(input: { surface: string }): Promise<string | undefined>;
    setBounds(message: BrowserBoundsMessage): void;
  };
  onEvent(listener: (event: HostEvent) => void): Disposer;
}

/** What `window.nyte` is: the SDK verbatim, plus watch-over-push and the host. */
export interface NyteBridge {
  readonly landing: Landing;
  readonly sessions: SessionsBridge;
  readonly messages: MessagesBridge;
  readonly jobs: RemoteNyte["jobs"];
  readonly runs: RunsBridge;
  readonly heads: HeadsBridge;
  readonly workspace: WorkspaceBridge;
  readonly provider: ProviderBridge;
  readonly plugins: PluginsBridge;
  /**
   * `onError` hears a watch that ended with an error (the SDK's `watch`
   * threw, or the start itself was refused), so a failure never dissolves
   * into silence.
   */
  watch(
    input: WatchInput,
    onEvent: (event: SessionEvent) => void,
    onError?: (error: Error) => void,
  ): Disposer;
  readonly host: HostBridge;
}

/** Walk `sessions.create` / `host.vcs.diff` to the matching NyteBridge method. */
type BridgeMethod<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? BridgeMethod<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/** The authoritative path-to-method relationship carried by Electron IPC. */
export type CallMethodByPath = {
  readonly [P in CallPath]: BridgeMethod<NyteBridge, P>;
};

export type CallInput<P extends CallPath> =
  Parameters<CallMethodByPath[P]> extends [] ? undefined : Parameters<CallMethodByPath[P]>[0];

export type CallOutput<P extends CallPath> = Awaited<ReturnType<CallMethodByPath[P]>>;

export type CallRequestFor<P extends CallPath> = P extends CallPath
  ? { readonly path: P; readonly input: CallInput<P> }
  : never;

export type CallRequest = { readonly [P in CallPath]: CallRequestFor<P> }[CallPath];

export type CallReplyFor<P extends CallPath> =
  | { readonly path: P; readonly ok: true; readonly value: CallOutput<P> }
  | { readonly ok: false; readonly error: IpcFailure };

export type CallReply = { readonly [P in CallPath]: CallReplyFor<P> }[CallPath];
