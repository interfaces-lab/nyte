import type {
  AddOutcome,
  Capability,
  ChangeSet,
  DiffOptions,
  EnvironmentIdentity,
  ForgetOutcome,
  JobId,
  PatchSet,
  RunId,
  WorkspaceId,
  WorkspaceInfo,
  WorkspaceInspection,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import type { BrowserApi } from "./browser.ts";
import type { FilesApi } from "./files.ts";
import type { GitApi } from "./git.ts";
import type { Job, Jobs } from "./jobs.ts";

/**
 * Registers and lists the folders and environments a host serves.
 *
 * **Details**
 *
 * There is no trust state. A registered workspace runs; `projectResources` says
 * whether its own code runs too. A tool invocation's sdk has no owner
 * authority, so a run cannot register a folder.
 *
 * @category workspaces
 * @since 0.1.0
 */
export interface Workspaces {
  /**
   * Returns the workspaces registered on this host.
   *
   * @authority participant
   */
  list(): Promise<readonly WorkspaceInfo[]>;
  /**
   * Resolves a target's identity and scans its project resources; registers
   * nothing. What a client shows before `add`.
   *
   * @throws {SdkError} unavailable when no environment provider serves the target's kind.
   * @authority owner
   */
  inspect(target: WorkspaceTarget): Promise<WorkspaceInspection>;
  /**
   * Registers a workspace.
   *
   * **Outcomes**
   *
   * - `added`: registered; `workspace` is its id.
   * - `exists`: already registered; `workspace` is the existing id.
   * - `stale`: the identity no longer matches `expect`; `identity` is current.
   * - `unavailable`: the provider cannot reach it; `reason` says why.
   *
   * **Details**
   *
   * `projectResources` defaults to true: the owner adding it is the consent. Pass
   * the inspected identity as `expect` so a folder swapped under the path is
   * `stale`, not added.
   *
   * **Example** (Open Folder, or /cd in the tui)
   *
   * ```ts
   * declare const connection: Connection;
   * declare const session: Session;
   * declare function askUser(seen: WorkspaceInspection): Promise<boolean>;
   *
   * async function openFolder(path: string) {
   *   const seen = await connection.workspaces.inspect({ kind: "local", path });
   *   // The client's own dialog, if it wants one; core behaves the same without it.
   *   if (seen.registered === null && seen.projectSources.length > 0 && !(await askUser(seen))) return;
   *   const added = await connection.workspaces.add(seen.target, {
   *     expect: { identity: seen.identity },
   *   });
   *   // stale: the folder changed under the path; inspect again.
   *   if (added.kind === "stale") return openFolder(path);
   *   // The idle tree relocates; busy if a run is live.
   *   if (added.kind === "added" || added.kind === "exists") await session.update({ workspace: added.workspace });
   * }
   * ```
   *
   * @authority owner
   */
  add(target: WorkspaceTarget, options?: { readonly projectResources?: boolean; readonly expect?: { readonly identity: EnvironmentIdentity } }): Promise<AddOutcome>;
  /**
   * Removes the workspace record; never touches files.
   *
   * **Outcomes**
   *
   * - `forgotten`: the record is gone.
   * - `busy`: `sessions` still use it.
   *
   * @authority owner
   */
  forget(id: WorkspaceId): Promise<ForgetOutcome>;
}

/**
 * Returns a handle on one workspace: its info, its jobs, the changes runs
 * made, and its capabilities.
 *
 * **Details**
 *
 * Processes and files belong to the environment, not the session. Each
 * capability method returns a `Capability` that reports provision:
 * unsupported (no driver), denied (this principal), unavailable (driver down,
 * retry allowed or not), or available. Asking for one starts nothing. Every
 * write under a capability takes `expect?` and answers stale when the thing
 * moved; there is no guarded sub-handle and no `at(revision)`.
 *
 * @category workspaces
 * @since 0.1.0
 */
export interface Workspace {
  readonly id: WorkspaceId;
  /**
   * Returns the workspace record.
   *
   * @authority participant
   */
  info(): Promise<WorkspaceInfo>;
  /**
   * Yields the workspace record as it changes: availability, writers,
   * sessions.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<WorkspaceInfo>;
  /**
   * Turns project resources on or off.
   *
   * **Details**
   *
   * `false` loads user plugins only, from the next activation; the current
   * run finishes.
   *
   * @authority owner
   */
  update(patch: { readonly projectResources?: boolean }): Promise<{ readonly kind: "updated" } | { readonly kind: "missing" }>;
  /**
   * Re-reads project resources; sessions on this workspace re-activate. The
   * retry after `Activation` failed.
   *
   * @authority owner
   */
  reload(): Promise<{ readonly kind: "updated" } | { readonly kind: "missing" }>;
  /** Background processes in this workspace. */
  readonly jobs: Jobs;
  /**
   * Returns a handle on a job by id.
   *
   * @handle
   */
  job(id: JobId): Job;
  /**
   * Returns what a run changed, from the environment's recorded snapshots.
   *
   * **Details**
   *
   * Run snapshots are an environment capability, separate from git. A
   * provider that serves files records a content-addressed tree before and
   * after each run, across every mutation path: edit tools, write tools,
   * shell, jobs. Git-backed via hidden refs where a repository exists;
   * filesystem-hashed where not. So `changes(run)` is honest everywhere files
   * are, and works with or without a repository. It is what `view.changes`,
   * `turn.summary` and tool `state.changes` read from. Recording edit-tool
   * patches alone is not tracking.
   *
   * @authority participant
   */
  changes(run: RunId): Promise<ChangeSet>;
  /**
   * Yields parsed patches for what a run changed, with the same batching,
   * cache and `PatchEntry` as `git.patches`.
   *
   * @see {@link GitApi.patches}
   * @stream frames
   * @authority participant
   */
  patches(run: RunId, paths: readonly string[], options?: DiffOptions): AsyncIterable<PatchSet>;
  /**
   * Returns the files capability.
   *
   * @authority participant
   */
  files(): Promise<Capability<FilesApi>>;
  /**
   * Returns the git capability.
   *
   * @authority participant
   */
  git(): Promise<Capability<GitApi>>;
  /**
   * Returns the browser capability.
   *
   * @authority participant
   */
  browser(): Promise<Capability<BrowserApi>>;
}
