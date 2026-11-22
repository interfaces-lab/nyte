import type { WorkspaceId } from "@nyte-ai/sdk";
import { filesFor } from "../../data/files.ts";
import { languageFor } from "../../data/language.ts";
import type { WorkbenchViewKey } from "../model.ts";
import type { FileBuffer } from "./file-document.ts";
import { fileActions } from "./file-store.ts";
import { indentUnit, TAB_COLUMNS } from "./indentation.ts";
import { languageDocuments } from "./language-documents.ts";
import { applyWorkspaceEdit } from "./workspace-edit.ts";

export async function formatDocument(input: {
  readonly view: WorkbenchViewKey;
  readonly workspace: { readonly id: WorkspaceId; readonly path: string };
  readonly path: string;
  readonly buffer: FileBuffer;
}): Promise<string | null> {
  const revision = input.buffer.getSnapshot().revision;
  const result = await (await filesFor(input.workspace.id)).format(input.path, input.buffer.text());

  if (result.kind === "failed") throw new Error(result.reason);

  if (result.kind === "formatted" && input.buffer.getSnapshot().revision === revision) {
    input.buffer.edit(result.contents);
  }

  if (result.kind !== "unavailable") return null;
  const language = await languageFor(input.workspace.id).catch(() => undefined);

  if (language === undefined) return result.reason;
  await languageDocuments.prepare(
    input.workspace.path,
    language,
    input.path,
    fileActions.documents(input.view),
  );
  const unit = indentUnit(input.path, input.buffer.text()) ?? "  ";
  const tab = unit === "\t";

  const outcome = await language.format({
    path: input.path,
    options: { tabSize: tab ? TAB_COLUMNS : unit.length, insertSpaces: !tab },
  });

  if (outcome.kind === "failed") throw new Error(outcome.reason);

  if (outcome.kind === "unavailable") return result.reason;

  if (input.buffer.getSnapshot().revision === revision) {
    await applyWorkspaceEdit({
      view: input.view,
      root: input.workspace.path,
      edit: { files: [{ path: input.path, edits: outcome.edits }] },
    });
  }

  return null;
}
