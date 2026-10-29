const MAX_FOLDER_ROWS = 4;

interface MentionPreviewRow {
  readonly kind: "folder" | "file";
  readonly label: string;
}

export function mentionPreviewRows(displayPath: string): readonly MentionPreviewRow[] {
  const segments = displayPath.split("/").filter((segment) => segment !== "");
  const collapsed = Math.max(0, segments.length - 1 - MAX_FOLDER_ROWS);

  const shown =
    collapsed === 0
      ? segments
      : [segments.slice(0, collapsed).join("/"), ...segments.slice(collapsed)];

  const mentionsFolder = displayPath.endsWith("/");

  return shown.map((label, index) => ({
    kind: index === shown.length - 1 && !mentionsFolder ? "file" : "folder",
    label,
  }));
}
