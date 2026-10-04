import type { MentionFile } from "@nyte-ai/client";

interface ComposerFileDropTransfer {
  readonly types: ArrayLike<string>;
  readonly files: FileList | readonly File[];
  dropEffect: string;
  getData(format: string): string;
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

let treeDrag: readonly MentionFile[] = [];

/** The workspace tree's drag carries only its row path as text, so the files ride here. */
export function setTreeDrag(files: readonly MentionFile[]): void {
  treeDrag = files;
}

export function carriesTreeFiles(event: ComposerFileDropEvent): boolean {
  const types = Array.from(event.dataTransfer?.types ?? []);

  return treeDrag.length > 0 && types.includes("text/plain") && !types.includes("Files");
}

/** The tree's files, when the dropped text is the path its drag started from. */
export function droppedTreeFiles(event: ComposerFileDropEvent): readonly MentionFile[] {
  const path = event.dataTransfer?.getData("text/plain");

  return carriesTreeFiles(event) && treeDrag.some((file) => file.displayPath === path)
    ? treeDrag
    : [];
}

export function dropHandlers(args: {
  readonly onFiles: (files: readonly File[]) => void;
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

      if (event.dataTransfer !== null)
        event.dataTransfer.dropEffect = accept(event) ? "copy" : "none";
    },
    onDrop: (event: ComposerFileDropEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!accept(event)) return;
      args.onFiles(Array.from(event.dataTransfer?.files ?? []));
    },
  };
}

export function bindComposerFileDrop(args: {
  readonly element: HTMLElement;
  readonly onFiles: (files: readonly File[]) => void;
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
