/** The brief and update prompts a review sends its reviewer, built from git reads. */
import type { CommitInfo } from "./git.ts";
import type { ReviewRecord } from "./registry.ts";
import type { FileChange, Revision } from "../src/review/wire.ts";

/** Patches up to this size ride in the brief; larger ones are read with diff_file. */
const INLINE_PATCH = 60_000;

const LISTED_COMMITS = 80;

/** The git reads a prompt needs, memoized by the caller: each commit pair is read once. */
export interface Reads {
  readonly commits: (base: string, head: string) => Promise<readonly CommitInfo[]>;
  readonly changes: (base: string, head: string) => Promise<readonly FileChange[]>;
  readonly patch: (base: string, head: string) => Promise<string>;
}

function fenced(language: string, text: string): string {
  return ["```" + language, text.replace(/\n$/, ""), "```"].join("\n");
}

function commitLines(commits: readonly CommitInfo[]): readonly string[] {
  const shown = commits
    .slice(0, LISTED_COMMITS)
    .map((entry) => `- ${entry.short} ${entry.subject} (${entry.author})`);

  const rest = commits.length - shown.length;

  return rest > 0 ? [...shown, `- … and ${rest} older commits`] : shown;
}

function fileLines(files: readonly FileChange[]): readonly string[] {
  const letter = { added: "A", modified: "M", deleted: "D", renamed: "R" } as const;

  return files.map(
    (file) =>
      `${letter[file.status]} ${file.path}${file.previousPath === undefined ? "" : ` (from ${file.previousPath})`} +${file.added} −${file.removed}`,
  );
}

export function totals(files: readonly FileChange[]) {
  return {
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

export async function briefPrompt(
  reads: Reads,
  record: ReviewRecord,
  revision: Revision,
): Promise<string> {
  const [list, files, patch] = await Promise.all([
    reads.commits(revision.base, revision.head),
    reads.changes(revision.base, revision.head),
    reads.patch(revision.base, revision.head),
  ]);

  const sum = totals(files);

  return [
    `Review: ${record.title}`,
    `Base: ${revision.base} (${record.baseRef})`,
    `Head: ${revision.head} (${record.headRef})`,
    "",
    `${list.length} commits, newest first:`,
    ...commitLines(list),
    "",
    `${files.length} changed files, +${sum.added} −${sum.removed}:`,
    ...fileLines(files),
    "",
    patch.length <= INLINE_PATCH
      ? `Patch:\n${fenced("diff", patch)}`
      : `The patch is ${patch.split("\n").length} lines, too long to include. Read files with diff_file from ${revision.base} to ${revision.head}.`,
    "",
    `Write the guide for ${revision.head}.`,
  ].join("\n");
}

export async function updatePrompt(
  reads: Reads,
  record: ReviewRecord,
  from: string,
  revision: Revision,
): Promise<string> {
  const [added, before, after, interdiff] = await Promise.all([
    reads.commits(from, revision.head),
    reads.changes(revision.base, from),
    reads.changes(revision.base, revision.head),
    reads.patch(from, revision.head),
  ]);

  const was = new Set(before.map((file) => file.path));
  const now = new Set(after.map((file) => file.path));
  const joined = after.filter((file) => !was.has(file.path)).map((file) => file.path);
  const left = before.filter((file) => !now.has(file.path)).map((file) => file.path);

  return [
    `${record.headRef} moved from ${from} to ${revision.head}; the base is unchanged.`,
    "",
    "New commits, newest first:",
    ...commitLines(added),
    "",
    joined.length === 0
      ? "No file joined the change."
      : `Files that joined the change: ${joined.join(", ")}`,
    left.length === 0
      ? "No file left the change."
      : `Files that left the change: ${left.join(", ")}`,
    "",
    interdiff.length <= INLINE_PATCH
      ? `Interdiff ${from}..${revision.head}:\n${fenced("diff", interdiff)}`
      : `The interdiff is too long to include. Read it with diff_file from ${from} to ${revision.head}.`,
    "",
    `Write the guide for ${revision.head}: publish the complete guide for ${revision.base}..${revision.head}, not only what changed.`,
  ].join("\n");
}
