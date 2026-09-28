interface ComposerFileDropTransfer {
  readonly types: ArrayLike<string>;
  readonly files: FileList | readonly File[];
  dropEffect: string;
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
