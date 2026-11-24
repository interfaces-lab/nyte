import { findLanguage } from "@nyte-ai/schema";
import type { LanguageName } from "@nyte-ai/schema";
import { languageDocument } from "@nyte-ai/sdk";
import type { LanguageApi, LanguageDocument, TextChange } from "@nyte-ai/sdk";

interface Held {
  readonly document: Promise<LanguageDocument | null>;
  sent: Promise<unknown>;
}

interface Workspace {
  readonly api: LanguageApi;
  readonly held: Map<string, Held>;
  readonly wanted: Set<LanguageName>;
}

const workspaces = new Map<string, Workspace>();

export const languageDocuments = {
  /** Records an edit the editor made, as LSP orders changes; `text` is the whole new text, read only if the file opens now. */
  edited(
    workspace: string,
    path: string,
    changes: readonly TextChange[],
    text: () => string,
  ): void {
    const found = workspaces.get(workspace);
    const language = findLanguage(path)?.name;

    if (found === undefined || language === undefined || !found.wanted.has(language)) return;
    const held = found.held.get(path);

    if (held === undefined) {
      open(found, path, text());

      return;
    }

    held.sent = Promise.all([held.sent, held.document]).then(async (settled) => {
      const document = settled[1];

      if (document !== null) await document.edit(changes);
    });
  },

  async prepare(
    workspace: string,
    api: LanguageApi,
    path: string,
    buffers: Iterable<{
      readonly path: string;
      readonly contents: string;
      readonly savedContents: string;
    }>,
  ): Promise<void> {
    const language = findLanguage(path)?.name;
    const found = workspaces.get(workspace) ?? { api, held: new Map(), wanted: new Set() };

    workspaces.set(workspace, found);

    if (language === undefined) return;
    found.wanted.add(language);

    for (const buffer of buffers) {
      if (
        findLanguage(buffer.path)?.name === language &&
        !found.held.has(buffer.path) &&
        buffer.contents !== buffer.savedContents
      ) {
        open(found, buffer.path, buffer.contents);
      }
    }

    await Promise.all(
      [...found.held.values()].map((held) => Promise.all([held.document, held.sent])),
    ).catch(() => undefined);
  },

  /** Hands a file back to the disk when no editor holds it any more. */
  closed(workspace: string, path: string): void {
    const found = workspaces.get(workspace);
    const held = found?.held.get(path);

    if (found === undefined || held === undefined) return;
    found.held.delete(path);
    void Promise.all([held.document, held.sent])
      .then((settled) => settled[0]?.close())
      .catch(() => undefined);
  },
};

function open(workspace: Workspace, path: string, text: string): void {
  const document = languageDocument(workspace.api, path, text).catch(() => null);

  workspace.held.set(path, { document, sent: document });
}
