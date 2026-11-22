import type { MentionFile } from "../data/files.ts";

interface ComposerFileDropTransfer {
  readonly types: ArrayLike<string>;
  readonly items: DataTransferItemList;
  dropEffect: string;
  getData(format: string): string;
}

export interface ComposerFile {
  readonly file: File;
  readonly kind: MentionFile["kind"];
}

export function transferredFiles(transfer: Pick<DataTransfer, "items">): readonly ComposerFile[] {
  return Array.from(transfer.items).flatMap((item) => {
    const file = item.getAsFile();

    if (file === null) return [];

    return [{ file, kind: item.webkitGetAsEntry()?.isDirectory === true ? "folder" : "file" }];
  });
}

interface ComposerFileDropEvent {
  readonly dataTransfer: ComposerFileDropTransfer | null;
  preventDefault(): void;
  stopPropagation(): void;
}

export function carriesFiles(event: ComposerFileDropEvent): boolean {
  const transfer = event.dataTransfer;

  return transfer !== null && Array.from(transfer.types).includes("Files");
}

let workbenchDrag: readonly MentionFile[] = [];

export function setWorkbenchDrag(files: readonly MentionFile[]): void {
  workbenchDrag = files;
}

export function carriesWorkbenchFiles(event: ComposerFileDropEvent): boolean {
  const types = new Set(Array.from(event.dataTransfer?.types ?? []));

  return workbenchDrag.length > 0 && types.has("text/plain") && !types.has("Files");
}

export function droppedWorkbenchFiles(event: ComposerFileDropEvent): readonly MentionFile[] {
  const path = event.dataTransfer?.getData("text/plain");

  return carriesWorkbenchFiles(event) && workbenchDrag.some((file) => file.displayPath === path)
    ? workbenchDrag
    : [];
}

function dropHandlers(args: {
  readonly onFiles: (files: readonly ComposerFile[]) => void;
  readonly disabled?: boolean;
}) {
  const accept = (event: ComposerFileDropEvent): boolean =>
    args.disabled !== true && carriesFiles(event);

  return {
    onDragEnter: (event: ComposerFileDropEvent) => {
      event.preventDefault();
    },
    onDragOver: (event: ComposerFileDropEvent) => {
      event.preventDefault();

      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = accept(event) ? "copy" : "none";
      }
    },
    onDrop: (event: ComposerFileDropEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!accept(event)) return;
      args.onFiles(event.dataTransfer === null ? [] : transferredFiles(event.dataTransfer));
    },
  };
}

export function bindComposerFileDrop(args: {
  readonly element: HTMLElement;
  readonly onFiles: (files: readonly ComposerFile[]) => void;
  readonly disabled?: boolean;
}): () => void {
  const { onDragEnter, onDragOver, onDrop } = dropHandlers(args);
  args.element.addEventListener("dragenter", onDragEnter);
  args.element.addEventListener("dragover", onDragOver);
  args.element.addEventListener("drop", onDrop);

  return () => {
    args.element.removeEventListener("dragenter", onDragEnter);
    args.element.removeEventListener("dragover", onDragOver);
    args.element.removeEventListener("drop", onDrop);
  };
}
