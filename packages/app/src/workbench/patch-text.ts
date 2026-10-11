import type { PatchEntry } from "@nyte-ai/sdk";

/**
 * A parsed text patch as unified diff text, for the renderer that takes text:
 * the hunks the host produced, written back line for line. No parsing; the
 * host already split the hunks and counted them.
 */
export function formatPatch(entry: Extract<PatchEntry, { readonly kind: "text" }>): string {
  const before =
    entry.status === "added" || entry.status === "untracked" ? "/dev/null" : `a/${entry.path}`;
  const after = entry.status === "deleted" ? "/dev/null" : `b/${entry.path}`;
  const lines = [`diff --git a/${entry.path} b/${entry.path}`, `--- ${before}`, `+++ ${after}`];

  for (const hunk of entry.hunks) {
    lines.push(
      `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@${hunk.header === null ? "" : ` ${hunk.header}`}`,
    );

    for (const line of hunk.lines) {
      lines.push(`${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`);

      if (line.noNewline === true) lines.push("\\ No newline at end of file");
    }
  }

  return `${lines.join("\n")}\n`;
}
