import { applyTextChange, SdkError } from "@nyte-ai/schema";
import type { LanguageServerView, TextChange } from "@nyte-ai/schema";
import type { LanguageApi } from "@nyte-ai/core";

export type LanguageDocument = {
  readonly path: string;
  /** The server that took the document when it was opened, or null for a file no language handles. */
  readonly server: LanguageServerView | null;
  /** Sends edits in the order they were made; a host that lost the document gets it again whole. */
  edit(changes: readonly TextChange[]): Promise<void>;
  close(): Promise<void>;
};

/**
 * Keeps one editor buffer in sync with the host's language server: each `edit` waits for the one
 * before it and moves the version on, as `LanguageApi.change` needs. A sketch of the whole path:
 *
 * ```ts
 * const language = await connection.workspace(id).language();
 * if (language.kind !== "available") return;
 * const document = await languageDocument(language.api, "main.go", text);
 * await document.edit([{ range: { start, end: start }, text: "stats." }]);
 * const list = await language.api.completion({ path: "main.go", position, trigger: { kind: "character", character: "." } });
 * const chosen = list.items[0]?.resolve;
 * const item = chosen ? await language.api.resolveCompletion({ token: chosen }) : null;
 * for await (const frames of language.api.diagnostics()) paint(frames);
 * ```
 */
export async function languageDocument(
  language: LanguageApi,
  path: string,
  text: string,
): Promise<LanguageDocument> {
  let current = text;
  let version = 1;
  let queue: Promise<void> = Promise.resolve();
  const server = await language.open({ path, text, version });

  const send = async (changes: readonly TextChange[]): Promise<void> => {
    current = changes.reduce(applyTextChange, current);
    version += 1;

    try {
      await language.change({ path, version, changes });
    } catch (error) {
      if (!(error instanceof SdkError) || (error.code !== "unknown" && error.code !== "stale"))
        throw error;
      version += 1;
      await language.open({ path, text: current, version });
    }
  };

  return {
    path,
    server,
    edit(changes) {
      const next = queue.then(() => send(changes));
      queue = next.catch(() => undefined);

      return next;
    },
    async close() {
      await queue;
      await language.close({ path });
    },
  };
}
