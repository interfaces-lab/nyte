import type { DragEvent } from "react";
import { carriesTreeFiles, droppedTreeFiles } from "../../references/composer-file-drop.ts";
import type { EditorDrop } from "../model.ts";

export const FILE_TAB_DRAG = "application/x-nyte-file-tab";

export function carriesEditorDrop(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes(FILE_TAB_DRAG) || carriesTreeFiles(event);
}

export function readEditorDrop(event: DragEvent<HTMLElement>): EditorDrop | undefined {
  const id = event.dataTransfer.getData(FILE_TAB_DRAG);

  if (id !== "") return { kind: "tab", id };
  const file = droppedTreeFiles(event).find((entry) => !entry.displayPath.endsWith("/"));

  return file === undefined ? undefined : { kind: "file", path: file.path };
}
