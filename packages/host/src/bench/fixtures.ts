import type { Host } from "@nyte-ai/core";

/** Makes `root` a git repository with `changed` modified tracked files: `file-<n>.txt` for n from 0, each committed with one line and then rewritten with a second line, so `changes({ kind: "worktree" })` lists exactly `changed` files; through the `git` CLI found on the PATH, with a fixed author and no hooks or signing. */
export async function gitFixture(root: string, changed: number): Promise<void> {
  throw new Error("not implemented");
}

/** Returns a git executable that counts its reads: a POSIX shell script written to `<dir>/git` (mode `0755`) that appends one line to `<dir>/git-diff-reads` whenever its subcommand (the first argument after any `-c <name>=<value>` pairs) is `diff`, then `exec`s the real `git` (resolved on the PATH when the script is written); `reads()` is that file's line count, read synchronously, 0 before the first. What `localProvider({ git })` runs, so the `gitDiffReads` counter is the host's real `git diff` count. */
export async function countingGit(
  dir: string,
): Promise<{ readonly path: string; reads(): number }> {
  throw new Error("not implemented");
}

/** Seeds `sessions` root sessions on the host's default workspace, each with `messagesPerSession` messages made without a model request: parts of the bench's `bench/message` kind (state `{ markdown }`, no actions) created on the transcript with role `note`, each landing as one commit on `main`, numbered `seed <session>.<message>`, the sessions one after another. */
export async function seedSessions(
  host: Host,
  counts: { readonly sessions: number; readonly messagesPerSession: number },
): Promise<void> {
  throw new Error("not implemented");
}
