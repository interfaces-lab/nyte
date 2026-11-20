import type { Document, FileVersion, FormatOutcome, WriteOutcome } from "@nyte-ai/sdk";
import type { EditorChange } from "@nyte-ai/ui/diffs/edit";
import { errorMessage } from "../../contract/errors.ts";

type TextFile = Extract<Document, { readonly kind: "text" }>;

interface FileSaveInput {
  readonly path: string;
  readonly contents: string;
  readonly version: FileVersion;
}

interface FileSaveOperations {
  readonly write: (input: FileSaveInput) => Promise<WriteOutcome>;
  readonly format?: (input: FileSaveInput) => Promise<FormatOutcome>;
}

type FileSaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "conflict" }
  | { readonly kind: "error"; readonly message: string };

export interface FileDocumentSnapshot {
  readonly savedContents: string;
  readonly version: FileVersion;
  readonly dirty: boolean;
  readonly remote: boolean;
  readonly revision: number;
  readonly status: FileSaveState;
}

export type DocumentNews =
  | {
      readonly kind: "changes";
      readonly changes: readonly EditorChange[];
      readonly length: number;
    }
  | { readonly kind: "text"; readonly contents: string }
  | { readonly kind: "saved"; readonly contents: string; readonly version: FileVersion };

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
  let saving: Promise<void> | undefined;
  let again: { operations: FileSaveOperations; readonly done: Promise<void> } | undefined;
  let arrived: TextFile | undefined;

  const reader = (): DocumentEditor | undefined => editors.find((editor) => editor.alive());

  const text = (): string => reader()?.text() ?? held;

  const length = (): number => reader()?.length() ?? heldLength;

  let snapshot: FileDocumentSnapshot = {
    savedContents: document.contents,
    version: document.version,
    dirty: held !== document.contents,
    remote: false,
    revision: 0,
    status: { kind: "idle" },
  };

  const listeners = new Set<() => void>();
  const watchers = new Set<(news: DocumentNews) => void>();

  const tell = (news: DocumentNews): void => {
    for (const watcher of watchers) watcher(news);
  };

  const publish = (next: FileDocumentSnapshot): void => {
    snapshot = next;

    for (const listener of listeners) listener();
  };

  const differs = (saved: string, savedFlat: number): boolean =>
    length() !== savedFlat || text() !== saved;

  const typed = (remote: boolean): void =>
    publish({
      ...snapshot,
      dirty: differs(snapshot.savedContents, savedLength),
      remote,
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
      remote: false,
      revision: snapshot.revision + 1,
      status: { kind: "idle" },
    });
  };

  const observeDisk = (next: TextFile): void => {
    if (saving !== undefined) {
      arrived = next;

      return;
    }

    if (snapshot.status.kind === "saving" || snapshot.dirty) return;

    if (snapshot.version === next.version) return;
    reload(next);
  };

  const saveOnce = async (operations: FileSaveOperations): Promise<void> => {
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

      if (setText(contents)) {
        publish({ ...snapshot, revision: snapshot.revision + 1 });
        tell({ kind: "text", contents });
      }

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
      tell({ kind: "saved", contents, version: outcome.version });
    } catch (cause: unknown) {
      publish({
        ...snapshot,
        status: {
          kind: "error",
          message: errorMessage(cause),
        },
      });
    } finally {
      saving = undefined;
      const late = arrived;
      arrived = undefined;

      if (late !== undefined && late.version !== captured.version) observeDisk(late);
    }
  };

  const save = (operations: FileSaveOperations): Promise<void> => {
    if (saving === undefined) {
      saving = saveOnce(operations);

      return saving;
    }

    if (again !== undefined) {
      again.operations = operations;

      return again.done;
    }

    const done = saving.then(async () => {
      const next = again;
      again = undefined;

      if (next !== undefined && snapshot.dirty) await save(next.operations);
    });

    again = { operations, done };

    return done;
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
      if (!setText(contents)) return;
      typed(false);
      tell({ kind: "text", contents });
    },
    watch(watcher: (news: DocumentNews) => void): () => void {
      watchers.add(watcher);

      return () => {
        watchers.delete(watcher);
      };
    },
    receive(news: DocumentNews): boolean {
      if (news.kind === "saved") {
        savedLength = flatLength(news.contents);
        publish({
          ...snapshot,
          savedContents: news.contents,
          version: news.version,
          dirty: differs(news.contents, savedLength),
        });

        return true;
      }

      if (news.kind === "text") {
        if (setText(news.contents)) typed(true);

        return true;
      }

      const live = editors.filter((editor) => editor.alive());

      if (live.length === 0) return false;

      for (const editor of live)
        write(editor, editor === live[0], () => editor.apply(news.changes));

      typed(true);

      return length() === news.length;
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

      typed(false);
      tell({ kind: "changes", changes, length: length() });

      return true;
    },
    observeDisk,
    discard(next: TextFile): void {
      if (snapshot.status.kind === "saving") return;
      reload(next);
      tell({ kind: "text", contents: next.contents });
      tell({ kind: "saved", contents: next.contents, version: next.version });
    },
    save,
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
