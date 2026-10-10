import type { EnvironmentProvider, ExecutionEnv } from "@nyte-ai/core";

/** Returns an environment's run snapshots: what `EnvironmentProvider.snapshots` answers for one environment. */
export type Snapshots = ReturnType<NonNullable<EnvironmentProvider["snapshots"]>>;

/** Returns content-addressed snapshots of an environment's tree, so equal trees are equal ids whichever run took them. In a repository (`git`, default `git` on the PATH, run in `env.cwd`), `before` and `after` write the worktree, tracked and untracked files that are not ignored, into a temporary index (`GIT_INDEX_FILE`, `git add -A`, `git write-tree`) and keep the tree reachable under the hidden ref `refs/nyte/snapshots/<tree>`; the id is `git:<tree>`. Without a repository they walk the tree as `localFiles.scan` does, store each file's bytes once under `<store>/objects/<sha256>` and the manifest of paths to content hashes under `<store>/trees/<sha256 of the manifest>`; the id is `tree:<hash>`. `diff(from, to)` answers the `ChangeSet` between two snapshots with line stats (`git diff-tree --numstat -z --find-renames`, or the two manifests compared), its `revision` `to`; `patches(from, to, paths)` answers one `PatchEntry` per path, parsed into hunks as `localGit` parses them. */
export function localSnapshots(
  env: ExecutionEnv,
  options: { readonly store: string; readonly git?: string },
): Snapshots {
  throw new Error("not implemented");
}
