import type {
  BlameView,
  ChangeSet,
  Cursor,
  DiffOptions,
  GitCommitView,
  GitFileSides,
  GitOutcome,
  GitRefsView,
  GitScope,
  GitStatus,
  GitWrite,
  Paged,
  PatchSet,
} from "@nyte-ai/schema";

/**
 * Reads repository status, comparisons and history, and writes the index,
 * commits, branches and pushes.
 *
 * **Details**
 *
 * Git belongs to the environment, not the host. The kernel may run with no
 * filesystem at all (a durable object) and still own sessions, runs and
 * parts; git exists wherever the environment provider is. `Capability<GitApi>`
 * answers unsupported for an environment with no filesystem, and status
 * `"none"` for a folder with no repository. The local and sandbox providers
 * supply git, CLI where there is one and in-process where there is not; a
 * chat-only provider supplies none. Hunks are produced by the provider; no
 * client parses text.
 *
 * Git is the one VCS capability; another VCS is another capability with its
 * own shape, not a second `GitApi` implementation.
 *
 * Writes take `expect`, the status revision the client showed. Branch,
 * commit and push are three calls with three outcomes; report each.
 *
 * @category git
 * @since 0.1.0
 */
export interface GitApi {
  /**
   * Returns the repository status, or `{ kind: "none" }` when there is no
   * repository.
   *
   * **Details**
   *
   * A repository status carries root, head, branch, upstream, revision,
   * staged index files and unstaged worktree files. `head` null means an
   * unborn repository. `"none"` means no repository, not unsupported git.
   *
   * @authority participant
   */
  status(): Promise<GitStatus>;
  /**
   * Yields the status as it changes.
   *
   * **Details**
   *
   * Core rescans after a write-class tool settles and on fs events; the
   * client never asks.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<GitStatus>;

  /**
   * Returns the files a scope changes, with names and line stats.
   *
   * **Details**
   *
   * A scope names what is compared; the returned revision names the state it
   * was read at. Reads are cheap (names and line stats); patches are on
   * demand.
   *
   * @authority participant
   */
  changes(scope: GitScope, options?: DiffOptions): Promise<ChangeSet>;
  /**
   * Yields the changed files as the revision moves.
   *
   * @stream watch
   * @authority participant
   */
  watchChanges(scope: GitScope, options?: DiffOptions): AsyncIterable<ChangeSet>;
  /**
   * Yields parsed patches for the requested paths: the Changes panel's whole
   * data need.
   *
   * **Details**
   *
   * The sdk:
   *
   * - batches concurrent and newly requested paths into host reads of at
   *   most `PATCH_READ_MAX` paths, with bounded concurrency, so expanding
   *   every file is a few rounds, not a read per file;
   * - caches by (scope, revision, path), structurally shared, so a path read
   *   once is never read again at that revision;
   * - holds the previous revision's entry for a path while the fresh one is
   *   in flight, marked `fresh: false`, so the panel never blanks when the
   *   tree moves; a path the new revision no longer reports leaves;
   * - parses once, on the host, into hunks. No client parses unified text.
   *
   * Each yield is the full map for the requested paths; unchanged entries
   * keep identity. Changing paths (scroll, expand all) is a new call; the
   * cache is shared across calls on the same connection.
   *
   * **Example** (Feeding the Changes panel)
   *
   * ```ts
   * declare const git: GitApi;
   * declare function render(entries: PatchSet["entries"]): void;
   *
   * const changes = await git.changes({ kind: "worktree" });
   * const paths = changes.files.map((file) => file.path);
   * for await (const set of git.patches({ kind: "worktree" }, paths, { ignoreWhitespace: true })) {
   *   render(set.entries);
   * }
   * ```
   *
   * @stream frames
   * @authority participant
   */
  patches(scope: GitScope, paths: readonly string[], options?: DiffOptions): AsyncIterable<PatchSet>;
  /**
   * Returns a file's old and new sides under a scope: each absent, text,
   * truncated `{ head }` or binary.
   *
   * @authority participant
   */
  contents(path: string, scope: GitScope): Promise<GitFileSides>;

  /**
   * Returns one page of commit history.
   *
   * @authority participant
   */
  log(input?: { readonly cursor?: Cursor; readonly limit?: number }): Promise<Paged<GitCommitView>>;
  /**
   * Returns branches, tags and remotes.
   *
   * @authority participant
   */
  refs(): Promise<GitRefsView>;
  /**
   * Returns per-line authorship for a file.
   *
   * @authority participant
   */
  blame(path: string): Promise<BlameView>;

  /**
   * Stages paths; proceeds while a run is writing.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  stage(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  /**
   * Unstages paths; proceeds while a run is writing.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  unstage(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  /**
   * Discards worktree changes to paths; answers busy while a run is writing.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  discard(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  /**
   * Commits staged, all, or the listed files; answers busy while a run is
   * writing.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  commit(input: { readonly message: string; readonly files: "staged" | "all" | readonly string[] }, options?: GitWrite): Promise<GitOutcome>;
  /**
   * Creates a branch, and checks it out if asked.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  branch(input: { readonly name: string; readonly checkout: boolean }, options?: GitWrite): Promise<GitOutcome>;
  /**
   * Pushes the current branch.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  push(input?: { readonly setUpstream?: boolean }, options?: GitWrite): Promise<GitOutcome>;
}
