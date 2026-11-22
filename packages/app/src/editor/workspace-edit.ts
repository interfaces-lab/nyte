import type { TextEdit, TextPosition, WorkspaceEdit } from "@nyte-ai/schema";
import type { EditorChange } from "@nyte-ai/ui/diffs/edit";
import { documentsApi, writeDocument } from "../data/documents.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { workspaceFile } from "../workbench/paths.ts";
import { absolutePath } from "./declaration.ts";
import type { FileBuffer } from "./file-document.ts";
import { fileActions } from "./file-store.ts";
import { languageDocuments } from "./language-documents.ts";
import { editorRange, textChanges } from "./pierre-language.ts";

export async function applyWorkspaceEdit(input: {
  readonly view: WorkbenchViewKey;
  readonly root: string;
  readonly edit: WorkspaceEdit;
}): Promise<void> {
  const files = input.edit.files
    .filter((file) => file.edits.length > 0)
    .map((file) => {
      const path = absolutePath(input.root, file.path);

      return { path, edits: file.edits, buffer: fileActions.buffer(input.view, path) };
    });

  const outside = files.filter((file) => workspaceFile(file.path, [input.root]) === undefined);

  if (outside.length > 0)
    throw new Error(
      `The edit reaches outside the workspace, so nothing changed: ${outside.map((file) => file.path).join(", ")}`,
    );

  const closed = await Promise.all(
    files
      .filter((file) => file.buffer === undefined)
      .map(async (file) => ({ ...file, document: await readText(file.path) })),
  );

  for (const file of files)
    if (file.buffer !== undefined) editBuffer(input.root, file.path, file.buffer, file.edits);

  const written = await Promise.all(
    closed.map(async (file) => ({
      path: file.path,
      outcome: await writeDocument({
        path: file.path,
        contents: spliced(
          file.document.contents,
          editorChanges(file.document.contents, file.edits),
        ),
        encoding: file.document.encoding,
        expect: file.document.version,
      }),
    })),
  );

  const stale = written.filter((file) => file.outcome.kind !== "saved").map((file) => file.path);

  if (stale.length > 0)
    throw new Error(
      `The edit skipped ${stale.join(", ")}, which changed on disk since it was read.`,
    );
}

function editBuffer(
  root: string,
  path: string,
  buffer: FileBuffer,
  edits: readonly TextEdit[],
): void {
  const text = buffer.text();
  const changes = editorChanges(text, edits);

  buffer.edit(spliced(text, changes), changes);
  languageDocuments.edited(root, path, textChanges(changes), () => buffer.text());
}

async function readText(path: string) {
  const document = await (await documentsApi()).read(path, { as: "document" });

  if (document.kind !== "text") throw new Error(`${path} can't be edited as text.`);

  return document;
}

function editorChanges(text: string, edits: readonly TextEdit[]): readonly EditorChange[] {
  const starts = [0, ...Array.from(text.matchAll(/\n/gu), (match) => match.index + 1)];

  const offset = (position: TextPosition): number => {
    const start = starts[position.line];

    if (start === undefined) return text.length;

    return Math.min(
      start + position.utf16Column,
      (starts[position.line + 1] ?? text.length + 1) - 1,
    );
  };

  return edits
    .map((edit) => ({
      start: offset(edit.range.start),
      end: offset(edit.range.end),
      text: edit.text,
      range: editorRange(edit.range),
    }))
    .toSorted((first, second) => first.start - second.start);
}

function spliced(text: string, changes: readonly EditorChange[]): string {
  return (
    changes
      .map((change, index) => text.slice(changes[index - 1]?.end ?? 0, change.start) + change.text)
      .join("") + text.slice(changes.at(-1)?.end ?? 0)
  );
}
