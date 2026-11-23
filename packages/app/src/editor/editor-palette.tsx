import type { ReactElement } from "react";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import type { EditorData } from "./editor-data.ts";
import { FilePalette } from "./file-palette.tsx";
import { fileActions } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";
import { characterAtColumn, lineAt, TAB_COLUMNS } from "./indentation.ts";
import type { OutlineSymbol } from "./outline.ts";

/** The editor's palette: quick open, the active file's symbols, and go to line. */
export function EditorPalette({
  viewKey,
  query,
  files,
  recent,
  activeFile,
  activeContents,
  symbols,
  onQueryChange,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly query: string | undefined;
  readonly files: EditorData["files"];
  readonly recent: readonly string[];
  readonly activeFile: FileTab | undefined;
  readonly activeContents: string | undefined;
  readonly symbols: readonly OutlineSymbol[];
  readonly onQueryChange: (query: string | undefined) => void;
}): ReactElement {
  const recentFiles = recent.flatMap((path) => {
    const file = files.data?.find((entry) => entry.path === path);

    return file === undefined ? [] : [file];
  });

  return (
    <FilePalette
      query={query}
      files={files.data}
      recent={recentFiles}
      filesError={files.error}
      onRetryFiles={() => void files.refetch()}
      active={
        activeFile === undefined || activeContents === undefined
          ? undefined
          : { path: activeFile.path, contents: activeContents, symbols }
      }
      onQueryChange={onQueryChange}
      onClose={() => onQueryChange(undefined)}
      onOpenFile={(file) => fileActions.open(viewKey, file)}
      onGoTo={(line, column) => {
        if (activeFile === undefined) return;

        const text = fileActions
          .documents(viewKey)
          .find((document) => document.path === activeFile.path)?.contents;

        fileActions.open(viewKey, {
          path: activeFile.path,
          target: {
            kind: "position",
            line,
            column:
              column === undefined || text === undefined
                ? column
                : characterAtColumn(lineAt(text, line - 1), column - 1, TAB_COLUMNS) + 1,
          },
        });
      }}
    />
  );
}
