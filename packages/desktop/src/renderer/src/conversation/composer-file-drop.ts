const ACCEPTED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export interface ComposerFileDropTransfer {
  readonly types: ArrayLike<string>;
  readonly files: FileList | readonly File[];
  dropEffect: string;
}

export interface ComposerFileDropEvent {
  readonly dataTransfer: ComposerFileDropTransfer | null;
  preventDefault(): void;
  stopPropagation(): void;
}

export function carriesFiles(event: ComposerFileDropEvent): boolean {
  const transfer = event.dataTransfer;
  return transfer !== null && Array.from(transfer.types).includes("Files");
}

export function acceptedImageFiles(args: { readonly files: FileList | readonly File[] }): File[] {
  return Array.from(args.files).filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type));
}

export interface ComposerFileDropHandlers {
  readonly onDragEnter: (event: ComposerFileDropEvent) => void;
  readonly onDragOver: (event: ComposerFileDropEvent) => void;
  readonly onDrop: (event: ComposerFileDropEvent) => void;
}

export function dropHandlers(args: {
  readonly onFiles: (files: readonly File[]) => void;
  readonly disabled?: boolean;
}): ComposerFileDropHandlers {
  const accept = (event: ComposerFileDropEvent): boolean =>
    args.disabled !== true && carriesFiles(event);
  return {
    onDragEnter: (event) => {
      if (!accept(event)) return;
      event.preventDefault();
    },
    onDragOver: (event) => {
      if (!accept(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    },
    onDrop: (event) => {
      if (!accept(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const files = acceptedImageFiles({ files: event.dataTransfer?.files ?? [] });
      if (files.length === 0) return;
      args.onFiles(files);
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
