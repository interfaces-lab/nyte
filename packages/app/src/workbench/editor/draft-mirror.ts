import type { WorkbenchViewKey } from "../model.ts";
import type { FileBuffer } from "./file-document.ts";
import { fileActions, scheduleSave } from "./file-store.ts";

const DRAFT_MS = 300;

const AUTOSAVE_MS = 1_000;

export function mirrorDraft(input: {
  readonly buffer: FileBuffer;
  readonly viewKey: WorkbenchViewKey;
  readonly path: string;
  readonly autoSave: boolean;
  readonly save: () => Promise<void>;
}): () => void {
  const buffer = input.buffer;
  let draftTimer: number | undefined;
  let mirrored = buffer.getSnapshot();

  const publish = (): void => {
    window.clearTimeout(draftTimer);
    draftTimer = undefined;
    mirrored = buffer.getSnapshot();
    fileActions.setDraft(
      input.viewKey,
      input.path,
      mirrored.dirty
        ? {
            contents: buffer.text(),
            savedContents: mirrored.savedContents,
            version: mirrored.version,
          }
        : undefined,
    );
  };

  const synchronize = (): void => {
    const current = buffer.getSnapshot();
    fileActions.setSaving(input.viewKey, input.path, current.status.kind === "saving");

    const typed =
      current.status.kind !== "saving" &&
      current.savedContents === mirrored.savedContents &&
      current.version === mirrored.version &&
      current.dirty === mirrored.dirty;

    if (!typed) publish();
    else if (draftTimer === undefined) draftTimer = window.setTimeout(publish, DRAFT_MS);
  };

  synchronize();
  const unsubscribe = buffer.subscribe(synchronize);
  const stopSaving = input.autoSave ? scheduleSave(buffer, input.save, AUTOSAVE_MS) : undefined;

  return () => {
    unsubscribe();

    if (draftTimer !== undefined) publish();

    stopSaving?.();
  };
}
