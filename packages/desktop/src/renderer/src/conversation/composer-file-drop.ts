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

interface ComposerFileDropHandlers {
  readonly onDragEnter: (event: ComposerFileDropEvent) => void;
  readonly onDragOver: (event: ComposerFileDropEvent) => void;
  readonly onDrop: (event: ComposerFileDropEvent) => void;
}

/**
 * The default is always suppressed: Chromium's default for a dropped file is
 * to navigate the window to it. Whether the payload is taken is decided after.
 */
export function dropHandlers(args: {
  readonly onFiles: (files: readonly File[]) => void;
  readonly disabled?: boolean;
}): ComposerFileDropHandlers {
  const accept = (event: ComposerFileDropEvent): boolean =>
    args.disabled !== true && carriesFiles(event);
  return {
    onDragEnter: (event) => {
      event.preventDefault();
    },
    onDragOver: (event) => {
      event.preventDefault();
      if (event.dataTransfer !== null)
        event.dataTransfer.dropEffect = accept(event) ? "copy" : "none";
    },
    onDrop: (event) => {
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
  const handlers = dropHandlers({ onFiles: args.onFiles, disabled: args.disabled });
  const onDragEnter = (event: DragEvent): void => {
    handlers.onDragEnter(event);
  };
  const onDragOver = (event: DragEvent): void => {
    handlers.onDragOver(event);
  };
  const onDrop = (event: DragEvent): void => {
    handlers.onDrop(event);
  };
  args.element.addEventListener("dragenter", onDragEnter);
  args.element.addEventListener("dragover", onDragOver);
  args.element.addEventListener("drop", onDrop);
  return () => {
    args.element.removeEventListener("dragenter", onDragEnter);
    args.element.removeEventListener("dragover", onDragOver);
    args.element.removeEventListener("drop", onDrop);
  };
}
