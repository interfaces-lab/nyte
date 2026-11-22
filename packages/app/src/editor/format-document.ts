import type { WorkspaceEdit } from "@nyte-ai/schema";
import type { LanguageApi, WorkspaceId } from "@nyte-ai/sdk";
import { filesFor } from "../data/files.ts";
import { languageFor } from "../data/language.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import type { FileBuffer } from "./file-document.ts";
import { fileActions } from "./file-store.ts";
import { indentUnit, TAB_COLUMNS } from "./indentation.ts";
import { languageDocuments } from "./language-documents.ts";
import { applyWorkspaceEdit } from "./workspace-edit.ts";

interface FormatTarget {
  readonly view: WorkbenchViewKey;
  readonly workspace: { readonly id: WorkspaceId; readonly path: string };
  readonly path: string;
  readonly buffer: FileBuffer;
}

export async function formatDocument(
  input: FormatTarget & { readonly organize: boolean },
): Promise<string | null> {
  const language = await languageFor(input.workspace.id).catch(() => undefined);

  if (language !== undefined && input.organize)
    await editFromServer(input, language, () => organizedImports(input, language));

  const formatted =
    language !== undefined &&
    (await editFromServer(input, language, async () => {
      const text = input.buffer.text();
      const unit = indentUnit(input.path, text) ?? "  ";
      const tab = unit === "\t";

      const outcome = await language.format({
        path: input.path,
        options: { tabSize: tab ? TAB_COLUMNS : unit.length, insertSpaces: !tab },
      });

      if (outcome.kind === "failed") throw new Error(outcome.reason);

      return outcome.kind === "edits"
        ? { files: [{ path: input.path, edits: outcome.edits }] }
        : null;
    }));

  if (formatted) return null;
  const revision = input.buffer.getSnapshot().revision;
  const result = await (await filesFor(input.workspace.id)).format(input.path, input.buffer.text());

  if (result.kind === "failed") throw new Error(result.reason);

  if (result.kind === "formatted" && input.buffer.getSnapshot().revision === revision)
    input.buffer.edit(result.contents);

  return result.kind === "unavailable" ? result.reason : null;
}

async function editFromServer(
  input: FormatTarget,
  language: LanguageApi,
  compute: () => Promise<WorkspaceEdit | null>,
): Promise<boolean> {
  const revision = input.buffer.getSnapshot().revision;
  await languageDocuments.prepare(
    input.workspace.path,
    language,
    input.path,
    fileActions.documents(input.view),
  );
  const edit = await compute();

  if (edit === null) return false;

  if (input.buffer.getSnapshot().revision === revision)
    await applyWorkspaceEdit({ view: input.view, root: input.workspace.path, edit });

  return true;
}

async function organizedImports(
  input: FormatTarget,
  language: LanguageApi,
): Promise<WorkspaceEdit | null> {
  const lines = input.buffer.text().split(/\r\n|\r|\n/u);

  const actions = await language.codeActions({
    path: input.path,
    range: {
      start: { line: 0, utf16Column: 0 },
      end: { line: lines.length - 1, utf16Column: lines.at(-1)?.length ?? 0 },
    },
    only: ["source.organizeImports"],
  });

  const action = actions.find(
    (each) => each.kind === "source.organizeImports" && each.disabled === null,
  );

  if (action === undefined) return null;
  const outcome = await language.resolveCodeAction({ token: action.token });

  return outcome.kind === "edit" ? outcome.edit : null;
}
