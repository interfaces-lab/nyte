import type { WorkbenchViewKey } from "../model.ts";
import type { FileBuffer } from "./file-document.ts";
import { fileActions } from "./file-store.ts";

const DRAFT_MS = 300;

const AUTOSAVE_MS = 1_000;

/**
 * Keeps the file store's copy of a buffer's draft and saving state, and saves a draft a second after typing stops
 * when `autoSave` is on. Typing reaches the store at most every 300 ms, since only other panels read the draft
 * (search over unsaved files, the outline, the tab's dirty mark); turning dirty or clean, saving, a reload and
 * leaving reach it at once. Returns the function that stops it.
 */
export function mirrorDraft(input: {
  readonly buffer: FileBuffer;
  readonly viewKey: WorkbenchViewKey;
  readonly path: string;
  readonly autoSave: boolean;
  readonly save: () => Promise<void>;
}): () => void {
  const buffer = input.buffer;
  let saveTimer: number | undefined;
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

    window.clearTimeout(saveTimer);
    saveTimer = undefined;

    if (
      input.autoSave &&
      current.dirty &&
      (current.status.kind === "idle" || current.status.kind === "saved")
    )
      saveTimer = window.setTimeout(() => {
        saveTimer = undefined;
        void input.save();
      }, AUTOSAVE_MS);
  };

  synchronize();
  const unsubscribe = buffer.subscribe(synchronize);

  return () => {
    unsubscribe();

    if (draftTimer !== undefined) publish();

    window.clearTimeout(saveTimer);
  };
}
