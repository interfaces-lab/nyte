import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createSendJournal } from "@nyte-ai/sdk/client";
import type { JournalStorage, RequestJournal } from "@nyte-ai/sdk/client";

/**
 * The send journal in `journal/` under the Nyte home, one file per message, readable only by this
 * user because it holds what the person typed. Every `nyte` process on the home shares it, so a
 * message journaled by one is sent by the next to reach that host.
 */
export function fileJournal(
  folder = join(process.env["NYTE_HOME"] ?? join(homedir(), ".nyte"), "journal"),
): RequestJournal {
  return createSendJournal(fileStorage(folder));
}

/** Writes each entry to a temporary file and renames it into place, so a reader sees a whole entry or none. */
function fileStorage(folder: string): JournalStorage {
  const path = (key: string): string => join(folder, `${encodeURIComponent(key)}.json`);

  return {
    async read() {
      const names = await readdir(folder).catch(missing<string[]>([]));

      const stored = await Promise.all(
        names.map(async (name) => {
          const key = name.endsWith(".json") ? decodeName(name.slice(0, -".json".length)) : null;
          const text =
            key === null ? null : await readFile(join(folder, name), "utf8").catch(missing(null));

          return key === null || text === null ? [] : [[key, text] as const];
        }),
      );

      return stored.flat();
    },
    async write(key, text) {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const draft = `${path(key)}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;
      await writeFile(draft, text, { mode: 0o600 });
      await rename(draft, path(key));
    },
    remove: (key) => rm(path(key), { force: true }),
  };
}

/** A file another process removed between the listing and the read is one fewer entry. */
function missing<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return fallback;

    throw error;
  };
}

function decodeName(name: string): string | null {
  try {
    return decodeURIComponent(name);
  } catch {
    return null;
  }
}
