import { execFile } from "node:child_process";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { Host } from "@nyte-ai/core";
import { codeOf } from "../local/tree.ts";
import { benchMessage } from "./tools.ts";

const run = promisify(execFile);

const GIT_CONFIG = [
  "-c",
  "user.name=Nyte Bench",
  "-c",
  "user.email=bench@nyte.test",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/** Makes `root` a git repository with `changed` modified tracked files: `file-<n>.txt` for n from 0, each committed with one line and then rewritten with a second line, so `changes({ kind: "worktree" })` lists exactly `changed` files; through the `git` CLI found on the PATH, with a fixed author and no hooks or signing. */
export async function gitFixture(root: string, changed: number): Promise<void> {
  const git = (...args: readonly string[]) => run("git", [...GIT_CONFIG, ...args], { cwd: root });
  const files = Array.from({ length: changed }, (_, index) => join(root, `file-${index}.txt`));

  await mkdir(root, { recursive: true });
  await git("init", "-q", "-b", "main");
  await Promise.all(files.map((file) => writeFile(file, "line 1\n")));
  await git("add", "-A");
  await git("commit", "-q", "--allow-empty", "-m", "seed");
  await Promise.all(files.map((file) => writeFile(file, "line 1\nline 2\n")));
}

/** Returns a git executable that counts its reads: a POSIX shell script written to `<dir>/git` (mode `0755`) that appends one line to `<dir>/git-diff-reads` whenever its subcommand (the first argument after any `-c <name>=<value>` pairs) is `diff`, then `exec`s the real `git` (resolved on the PATH when the script is written); `reads()` is that file's line count, read synchronously, 0 before the first. What `localProvider({ git })` runs, so the `gitDiffReads` counter is the host's real `git diff` count. */
export async function countingGit(
  dir: string,
): Promise<{ readonly path: string; reads(): number }> {
  const real = await realGit(dir);
  const path = join(dir, "git");
  const counter = join(dir, "git-diff-reads");
  await mkdir(dir, { recursive: true });

  await writeFile(
    path,
    [
      "#!/bin/sh",
      "sub=",
      "skip=",
      'for arg in "$@"; do',
      '  if [ -n "$skip" ]; then skip=; continue; fi',
      '  if [ "$arg" = "-c" ]; then skip=1; continue; fi',
      '  sub="$arg"',
      "  break",
      "done",
      `if [ "$sub" = "diff" ]; then echo diff >> ${quoted(counter)}; fi`,
      `exec ${quoted(real)} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  return {
    path,
    reads() {
      try {
        return readFileSync(counter, "utf8")
          .split("\n")
          .filter((line) => line !== "").length;
      } catch (error) {
        if (codeOf(error) === "ENOENT") return 0;

        throw error;
      }
    },
  };
}

/** Seeds `sessions` root sessions on the host's default workspace, each with `messagesPerSession` messages made without a model request: parts of the bench's `bench/message` kind (state `{ markdown }`, no actions) created on the transcript with role `note`, each landing as one commit on `main`, numbered `seed <session>.<message>`, the sessions one after another. */
export async function seedSessions(
  host: Host,
  counts: { readonly sessions: number; readonly messagesPerSession: number },
): Promise<void> {
  for (let index = 0; index < counts.sessions; index += 1) {
    const session = await host.sessions.create();

    for (let message = 0; message < counts.messagesPerSession; message += 1)
      await session.parts.create(benchMessage, {
        state: { markdown: `seed ${index}.${message}` },
        placement: { kind: "transcript", role: "note" },
      });
  }
}

/** Returns the first executable `git` on the PATH outside `skip`, the directory the counting script lives in. */
async function realGit(skip: string): Promise<string> {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "" || dir === skip) continue;
    const candidate = join(dir, "git");

    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }

  throw new Error("No git executable is on the PATH.");
}

/** Returns a string as one single-quoted POSIX shell word. */
function quoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}
