import { languageDocument } from "@nyte-ai/sdk";
import type { LanguageApi, LanguageDocument, TextChange } from "@nyte-ai/sdk";

type Family = "go" | "typescript";

const FAMILIES = new Map<string, Family>([
  ["go", "go"],
  ...["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"].map(
    (extension) => [extension, "typescript"] satisfies [string, Family],
  ),
]);

interface Held {
  readonly document: Promise<LanguageDocument | null>;
  sent: Promise<unknown>;
}

interface Workspace {
  readonly api: LanguageApi;
  readonly held: Map<string, Held>;
  readonly wanted: Set<Family>;
}

const workspaces = new Map<string, Workspace>();

/** The language server family that would take a file, by its extension. */
export function languageFamily(path: string): Family | undefined {
  return FAMILIES.get(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}

/**
 * Keeps the host's language servers on the editor's text. A file is sent once its family's server
 * is in use and the editor's text differs from the disk the server would otherwise read: whole
 * when it opens, then each edit's changes, in order. Until then the server reads the file from disk.
 */
export const languageDocuments = {
  /** Records an edit the editor made, as LSP orders changes; `text` is the whole new text, read only if the file opens now. */
  edited(
    workspace: string,
    path: string,
    changes: readonly TextChange[],
    text: () => string,
  ): void {
    const found = workspaces.get(workspace);
    const family = languageFamily(path);

    if (found === undefined || family === undefined || !found.wanted.has(family)) return;
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

  /**
   * Starts sending a family's files before a query: every open file whose text differs from disk
   * opens now, and the query waits until the server has every edit made so far.
   */
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
    const family = languageFamily(path);
    const found = workspaces.get(workspace) ?? { api, held: new Map(), wanted: new Set() };

    workspaces.set(workspace, found);

    if (family === undefined) return;
    found.wanted.add(family);

    for (const buffer of buffers)
      if (
        languageFamily(buffer.path) === family &&
        !found.held.has(buffer.path) &&
        buffer.contents !== buffer.savedContents
      )
        open(found, buffer.path, buffer.contents);

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
