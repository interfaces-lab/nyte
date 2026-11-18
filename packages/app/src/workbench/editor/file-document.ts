import type { Document, FileVersion, FormatOutcome, WriteOutcome } from "@nyte-ai/sdk";
import type { EditorChange } from "@nyte-ai/ui/diffs/edit";
import { errorMessage } from "../../contract/errors.ts";

type TextFile = Extract<Document, { readonly kind: "text" }>;

interface FileSaveInput {
  readonly path: string;
  readonly contents: string;
  readonly version: FileVersion;
}

type FileSaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "conflict" }
  | { readonly kind: "error"; readonly message: string };

/** What the document knows besides the text: what disk holds, whether the text differs from it, and how saving is going. */
export interface FileDocumentSnapshot {
  readonly savedContents: string;
  readonly version: FileVersion;
  readonly dirty: boolean;
  readonly revision: number;
  readonly status: FileSaveState;
}

/**
 * An editor that shows the document. While one is attached it owns the text: the document reads it from there only
 * when something needs the whole text (a save, a format, the draft other panels read), and writes into it as edits.
 */
export interface DocumentEditor {
  readonly text: () => string;
  readonly length: () => number;
  readonly replace: (contents: string) => void;
  readonly apply: (changes: readonly EditorChange[]) => void;
  readonly alive: () => boolean;
}

/**
 * One open file's document. Without an editor attached it holds the text itself, so a hidden tab, the Markdown
 * document view, a save or a discard work the same. With editors attached, they hold it: Pierre's `TextDocument`
 * owns the draft and its history, and the document follows their changes without copying the text per keystroke.
 */
export function createFileDocument(document: TextFile, draft?: string) {
  let path = document.path;
  let held = draft ?? document.contents;
  let heldLength = flatLength(held);
  let savedLength = flatLength(document.contents);
  const editors: DocumentEditor[] = [];
  let writing: { readonly editor: DocumentEditor; readonly reported: boolean } | undefined;

  const reader = (): DocumentEditor | undefined => editors.find((editor) => editor.alive());

  const text = (): string => reader()?.text() ?? held;

  const length = (): number => reader()?.length() ?? heldLength;

  let snapshot: FileDocumentSnapshot = {
    savedContents: document.contents,
    version: document.version,
    dirty: held !== document.contents,
    revision: 0,
    status: { kind: "idle" },
  };

  const listeners = new Set<() => void>();

  const publish = (next: FileDocumentSnapshot): void => {
    snapshot = next;

    for (const listener of listeners) listener();
  };

  const differs = (saved: string, savedFlat: number): boolean =>
    length() !== savedFlat || text() !== saved;

  const typed = (): void =>
    publish({
      ...snapshot,
      dirty: differs(snapshot.savedContents, savedLength),
      revision: snapshot.revision + 1,
      status:
        snapshot.status.kind === "saved" || snapshot.status.kind === "error"
          ? { kind: "idle" }
          : snapshot.status,
    });

  const write = (editor: DocumentEditor, reported: boolean, change: () => void): void => {
    writing = { editor, reported };

    try {
      change();
    } finally {
      writing = undefined;
    }
  };

  const setText = (contents: string): boolean => {
    if (contents === text()) return false;
    held = contents;
    heldLength = flatLength(contents);

    const first = reader();

    for (const editor of editors.filter((each) => each.alive()))
      write(editor, editor === first, () => editor.replace(contents));

    return true;
  };

  const reload = (next: TextFile): void => {
    setText(next.contents);
    savedLength = flatLength(next.contents);
    publish({
      savedContents: next.contents,
      version: next.version,
      dirty: false,
      revision: snapshot.revision + 1,
      status: { kind: "idle" },
    });
  };

  return {
    getSnapshot: (): FileDocumentSnapshot => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    text,
    move(nextPath: string): void {
      path = nextPath;
    },
    edit(contents: string): void {
      if (setText(contents)) typed();
    },
    attach(editor: DocumentEditor): void {
      const current = text();

      editors.push(editor);

      if (editor.text() !== current)
        write(editor, editors.length === 1, () => editor.replace(current));
    },
    detach(editor: DocumentEditor, final: string): void {
      const index = editors.indexOf(editor);

      if (index === -1) return;
      editors.splice(index, 1);

      if (editors.length > 0) return;
      held = final;
      heldLength = flatLength(final);
    },
    edited(editor: DocumentEditor, changes: readonly EditorChange[]): boolean {
      if (writing !== undefined) return writing.editor === editor && writing.reported;

      for (const other of editors)
        if (other !== editor && other.alive()) write(other, false, () => other.apply(changes));

      typed();

      return true;
    },
    observeDisk(next: TextFile): void {
      if (snapshot.status.kind === "saving" || snapshot.dirty) return;

      if (snapshot.version === next.version) return;
      reload(next);
    },
    discard(next: TextFile): void {
      if (snapshot.status.kind === "saving") return;
      reload(next);
    },
    async save(operations: {
      readonly write: (input: FileSaveInput) => Promise<WriteOutcome>;
      readonly format?: (input: FileSaveInput) => Promise<FormatOutcome>;
    }): Promise<void> {
      if (snapshot.status.kind === "saving") return;
      const captured = snapshot;
      const unformatted = text();
      publish({ ...snapshot, status: { kind: "saving" } });

      try {
        const input = { path, contents: unformatted, version: captured.version };

        const formatted = await operations.format?.(input);

        if (snapshot.revision !== captured.revision) {
          publish({ ...snapshot, status: { kind: "idle" } });

          return;
        }

        const contents = formatted?.kind === "formatted" ? formatted.contents : unformatted;

        if (setText(contents)) publish({ ...snapshot, revision: snapshot.revision + 1 });

        const outcome = await operations.write({ ...input, contents });

        if (outcome.kind === "stale") {
          publish({ ...snapshot, status: { kind: "conflict" } });

          return;
        }

        if (outcome.kind === "missing-parent") {
          publish({
            ...snapshot,
            status: { kind: "error", message: "The file's folder is gone." },
          });

          return;
        }

        savedLength = flatLength(contents);
        publish({
          ...snapshot,
          savedContents: contents,
          version: outcome.version,
          dirty: differs(contents, savedLength),
          status: { kind: "saved" },
        });
      } catch (cause: unknown) {
        publish({
          ...snapshot,
          status: {
            kind: "error",
            message: errorMessage(cause),
          },
        });
      }
    },
  };
}

export type FileBuffer = ReturnType<typeof createFileDocument>;

function flatLength(text: string): number {
  return text.includes("\r") ? text.replace(/\r\n|\r/gu, "\n").length : text.length;
}

/** What an editor shows of its buffer besides the text: whether it differs from disk, and how saving is going. */
export interface BufferState {
  readonly dirty: boolean;
  readonly savedContents: string;
  readonly version: FileVersion;
  readonly status: FileSaveState;
}

export function bufferState(snapshot: FileDocumentSnapshot): BufferState {
  return {
    dirty: snapshot.dirty,
    savedContents: snapshot.savedContents,
    version: snapshot.version,
    status: snapshot.status,
  };
}

export function sameBufferState(first: BufferState, second: BufferState): boolean {
  return (
    first.dirty === second.dirty &&
    first.savedContents === second.savedContents &&
    first.version === second.version &&
    first.status === second.status
  );
}

/**
 * The buffer's text once typing pauses for `quietMs`, for work that reads the whole text, such as diffing it
 * against Git, and need not run on every key. Anything but an edit (a save, a reload, a discard) shows at once.
 */
export function settledContents(buffer: FileBuffer, quietMs: number) {
  let settled = buffer.text();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const publish = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const contents = buffer.text();

    if (contents === settled) return;
    settled = contents;

    for (const listener of listeners) listener();
  };

  let editing = buffer.getSnapshot();
  let release: (() => void) | undefined;

  const follow = (): void => {
    const previous = editing;
    editing = buffer.getSnapshot();

    const typed =
      editing.revision !== previous.revision &&
      editing.savedContents === previous.savedContents &&
      editing.status.kind !== "saving";

    if (editing.revision === previous.revision && editing.savedContents === previous.savedContents)
      return;

    if (!typed) return publish();

    clearTimeout(timer);
    timer = setTimeout(publish, quietMs);
  };

  return {
    getSnapshot: (): string => settled,
    subscribe: (listener: () => void): (() => void) => {
      if (release === undefined) {
        editing = buffer.getSnapshot();
        settled = buffer.text();
        release = buffer.subscribe(follow);
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size > 0) return;
        release?.();
        release = undefined;
        clearTimeout(timer);
      };
    },
  };
}
