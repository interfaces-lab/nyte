/**
 * The rows a mention preview draws for a workspace path: one per folder on the
 * way down, the mentioned file or folder last. Deep paths keep their tail and
 * collapse the folders above it into a single row, so the card stays short.
 *
 * Based on Cursor's file and folder path staircases in
 * `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js`.
 */

/** Folders that keep a row of their own; the ones above them share the first. */
const MAX_FOLDER_ROWS = 4;

export interface MentionPreviewRow {
  readonly kind: "folder" | "file";
  readonly label: string;
}

export function mentionPreviewRows(displayPath: string): readonly MentionPreviewRow[] {
  const segments = displayPath.split("/").filter((segment) => segment !== "");
  // The mention itself always keeps its own row; only the folders above it collapse.
  const collapsed = Math.max(0, segments.length - 1 - MAX_FOLDER_ROWS);
  const shown =
    collapsed === 0
      ? segments
      : [segments.slice(0, collapsed).join("/"), ...segments.slice(collapsed)];
  const isFolder = displayPath.endsWith("/");
  return shown.map((label, index) => ({
    kind: index === shown.length - 1 && !isFolder ? "file" : "folder",
    label,
  }));
}
