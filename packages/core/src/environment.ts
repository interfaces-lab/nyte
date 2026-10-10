import type { Availability, ChangeSet, DiffOptions, EnvironmentIdentity, PatchEntry, RunId, SnapshotId, WorkspaceTarget } from "@nyte-ai/schema";
import type { BrowserApi } from "./browser.ts";
import type { FilesApi } from "./files.ts";
import type { GitApi } from "./git.ts";
import type { Job } from "./jobs.ts";

/**
 * Returns what tools run against: files and exec, from the provider. Core
 * never reaches a filesystem except through it.
 *
 * @category environment
 * @since 0.1.0
 */
export interface ExecutionEnv {
  readonly identity: EnvironmentIdentity;
  readonly cwd: string;
  readonly files: FilesApi;
  /**
   * Starts a process as a job tied to the caller's signal; every process is
   * a job.
   *
   * **When to use**
   *
   * For a process the caller waits on. `jobs.start` is the background path,
   * with a report.
   */
  exec(command: string | readonly string[], options?: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>>; readonly signal?: AbortSignal; readonly pty?: { readonly columns: number; readonly rows: number } }): Promise<Job>;
  /** Detaches from the environment. */
  close(): Promise<void>;
}

/**
 * Layers behaviour on files and exec for one session, or adds a browser or
 * a browser; identity and cwd pass through.
 *
 * @category environment
 * @since 0.1.0
 */
export type EnvironmentWrap = (inner: ExecutionEnv) => ExecutionEnv & { readonly browser?: BrowserApi };

/**
 * Describes what a core plugin supplies to serve a workspace kind.
 *
 * **Details**
 *
 * `Capability<T>` on the workspace is derived from which of these the
 * provider supplies and which the principal may use.
 *
 * **Example** (A chat-only provider)
 *
 * ```ts
 * declare const emptyEnv: ExecutionEnv;
 *
 * const chatOnly = {
 *   kind: "chat-only",
 *   inspect: async () => ({
 *     identity: emptyEnv.identity,
 *     availability: { kind: "available" },
 *     projectSources: [],
 *   }),
 *   attach: async () => emptyEnv,
 * } satisfies EnvironmentProvider;
 *
 * export default { id: "chat-only", environment: chatOnly } satisfies Plugin<"core">;
 * ```
 *
 * @category environment
 * @since 0.1.0
 */
export interface EnvironmentProvider {
  /** "local", "sandbox", "chat-only"... */
  readonly kind: string;
  /** Resolves identity, availability and project sources; opens nothing. */
  inspect(target: WorkspaceTarget): Promise<{ readonly identity: EnvironmentIdentity; readonly availability: Availability; readonly projectSources: readonly string[] }>;
  /** Binds a folder, boots or joins a VM, connects a sandbox: the tools' hands. `close()` detaches; `destroy()` tears down. */
  attach(target: WorkspaceTarget): Promise<ExecutionEnv>;
  /** Required for local and sandbox. */
  readonly git?: (env: ExecutionEnv) => GitApi;
  /** Required wherever files are served: content-addressed trees before and after each run. */
  readonly snapshots?: (env: ExecutionEnv) => { before(run: RunId): Promise<SnapshotId>; after(run: RunId): Promise<SnapshotId>; diff(from: SnapshotId, to: SnapshotId): Promise<ChangeSet>; patches(from: SnapshotId, to: SnapshotId, paths: readonly string[], options?: DiffOptions): Promise<readonly PatchEntry[]> };
  /** Supplies a browser capability. */
  readonly browser?: (env: ExecutionEnv) => BrowserApi;
  /** Tears down remote sandboxes; local providers reject. */
  destroy?(target: WorkspaceTarget): Promise<void>;
}

/**
 * Returns what core scanned for a session: user and project files, skills,
 * context files, prompt files and prompt templates.
 *
 * **Details**
 *
 * After pi's resource loader, under `.nyte`, plus the agentskills.io
 * convention (`.agents/skills`) shared with other tools:
 *
 * - user: `~/.nyte/{skills,prompts,plugins}`, `~/.nyte/SYSTEM.md`,
 *   `~/.nyte/APPEND_SYSTEM.md`, `~/.nyte/AGENTS.md`, `~/.agents/skills`.
 * - project: `.nyte/{skills,prompts,plugins}`, `.nyte/SYSTEM.md`,
 *   `.nyte/APPEND_SYSTEM.md`, `.agents/skills`, and AGENTS.override.md ›
 *   AGENTS.md › CLAUDE.md in the workspace root and every ancestor up to /,
 *   root first; a git worktree's file shadows the main repository's by real
 *   path. Hidden entirely when `projectResources` is false.
 * - extra: skill paths from the host setting "skills.paths": a directory or
 *   a .md.
 *
 * Plugins consume the result and may add sources of their own: a plugin that
 * knows another source (a company registry) adds through
 * `contribute.skills`; nothing in core is the last word on where skills live.
 *
 * @category resources
 * @since 0.1.0
 */
export interface Resources {
  /** The local provider attached at the host home (its `.nyte` and `.agents` are under it); null when no local provider is registered (a durable object). The host machine is just another target of the local provider. */
  readonly user: FilesApi | null;
  /** Rooted at the workspace root (its `.nyte` and `.agents` are under it); null when projectResources is false or absent. */
  readonly project: FilesApi | null;
  /** Deduplicated by name, project wins; collisions reported on `HostView.plugins[].issues`. */
  readonly skills: readonly { readonly name: string; readonly location: string; readonly scope: "user" | "project" | "path"; readonly description: string }[];
  /** In prompt order: user, ancestors root-first, project. */
  readonly contextFiles: readonly { readonly path: string; readonly scope: "user" | "ancestor" | "project"; readonly content: string }[];
  /** SYSTEM.md replaces, APPEND_SYSTEM.md appends; project wins over user. */
  readonly prompt: { readonly system: string | null; readonly append: string | null; readonly scope: "user" | "project" | null };
  /** Reusable prompt templates, for commands. */
  readonly prompts: readonly { readonly name: string; readonly location: string; readonly scope: "user" | "project" }[];
}
