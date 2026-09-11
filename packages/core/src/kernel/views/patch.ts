import { parsePatch, type StructuredPatch } from "diff";
import type { FileChange } from "@nyte-ai/protocol";

export type PatchStat = Pick<FileChange, "added" | "removed">;

export type PatchFile = Readonly<StructuredPatch> & PatchStat & { readonly path?: string };

export interface ParsedPatch extends PatchStat {
  /** The original bytes, never reconstructed from the parsed hunks. */
  readonly patch: string;
  readonly files: readonly PatchFile[];
}

/** Parse once at the patch boundary; all accounting uses hunk-body markers. */
export function parsePatchFacts(patch: string): ParsedPatch | undefined {
  let parsed;
  try {
    parsed = parsePatch(patch);
  } catch {
    return undefined;
  }
  const files: PatchFile[] = [];
  // jsdiff accepts a missing one-line side at EOF by rewriting its count to zero.
  // Retain the declared counts so truncated results cannot become successful diffs.
  // Match jsdiff's LF boundaries; CR and Unicode separators can be hunk content.
  const headers = patch
    .split("\n")
    .map((line) => /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line))
    .filter((header) => header !== null)
    .values();
  let added = 0;
  let removed = 0;
  for (const file of parsed) {
    let fileAdded = 0;
    let fileRemoved = 0;
    for (const hunk of file.hunks) {
      const header = headers.next().value;
      if (
        header === undefined ||
        !Number.isSafeInteger(hunk.oldStart) ||
        !Number.isSafeInteger(hunk.newStart) ||
        hunk.oldLines !== Number(header[2] ?? 1) ||
        hunk.newLines !== Number(header[4] ?? 1)
      )
        return undefined;
      for (const line of hunk.lines) {
        if (line.startsWith("+")) fileAdded += 1;
        if (line.startsWith("-")) fileRemoved += 1;
      }
    }
    const name = file.newFileName === "/dev/null" ? file.oldFileName : file.newFileName;
    const prefix = file.newFileName === "/dev/null" ? "a/" : "b/";
    const path = name?.startsWith(prefix) ? name.slice(2) : name;
    const facts = { ...file, added: fileAdded, removed: fileRemoved };
    files.push(
      path === undefined || path === "" || path === "/dev/null" ? facts : { ...facts, path },
    );
    added += fileAdded;
    removed += fileRemoved;
  }
  if (!headers.next().done) return undefined;
  return { patch, files, added, removed };
}
