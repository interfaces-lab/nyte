import type { FileDocument, FileVersion, FormatOutcome, WriteOutcome } from "@nyte-ai/sdk";
import { errorMessage } from "../errors.ts";

type TextFile = Extract<FileDocument, { readonly kind: "text" }>;

/** What a save hands its write and format steps: the path, the text, and the version it was read at. */
export interface FileSaveInput {
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

export interface FileDocumentSnapshot {
  readonly contents: string;
  readonly savedContents: string;
  readonly version: FileVersion;
  readonly revision: number;
  readonly status: FileSaveState;
}

/** A save acknowledges only the captured text, never edits made while the write is pending. */
export function createFileDocument(document: TextFile, draft?: string) {
  let snapshot: FileDocumentSnapshot = {
    contents: draft ?? document.contents,
    savedContents: document.contents,
    version: document.version,
    revision: 0,
    status: { kind: "idle" },
  };

  const listeners = new Set<() => void>();

  const publish = (next: FileDocumentSnapshot): void => {
    snapshot = next;

    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: (): FileDocumentSnapshot => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    edit(contents: string): void {
      if (contents === snapshot.contents) return;
      publish({
        ...snapshot,
        contents,
        revision: snapshot.revision + 1,
        status: snapshot.status.kind === "saved" ? { kind: "idle" } : snapshot.status,
      });
    },
    /** Refetches cannot move the save baseline underneath an unsaved draft. */
    observeDisk(next: TextFile): void {
      if (snapshot.status.kind === "saving" || snapshot.contents !== snapshot.savedContents) return;

      if (snapshot.version === next.version) return;
      publish({
        contents: next.contents,
        savedContents: next.contents,
        version: next.version,
        revision: snapshot.revision + 1,
        status: { kind: "idle" },
      });
    },
    discard(next: TextFile): void {
      if (snapshot.status.kind === "saving") return;
      publish({
        contents: next.contents,
        savedContents: next.contents,
        version: next.version,
        revision: snapshot.revision + 1,
        status: { kind: "idle" },
      });
    },
    async save(operations: {
      readonly write: (input: FileSaveInput) => Promise<WriteOutcome>;
      readonly format?: (input: FileSaveInput) => Promise<FormatOutcome>;
    }): Promise<void> {
      if (snapshot.status.kind === "saving") return;
      const captured = snapshot;
      publish({ ...snapshot, status: { kind: "saving" } });

      try {
        const input = {
          path: document.path,
          contents: captured.contents,
          version: captured.version,
        };

        const formatted = await operations.format?.(input);

        if (formatted?.kind === "unavailable") {
          publish({ ...snapshot, status: { kind: "error", message: formatted.reason } });

          return;
        }

        // Formatting may take seconds. Do not replace text typed in the meantime.
        if (snapshot.revision !== captured.revision) {
          publish({ ...snapshot, status: { kind: "idle" } });

          return;
        }

        const contents = formatted?.kind === "formatted" ? formatted.contents : captured.contents;

        if (contents !== snapshot.contents) {
          publish({ ...snapshot, contents, revision: snapshot.revision + 1 });
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

        publish({
          ...snapshot,
          savedContents: contents,
          version: outcome.version,
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
