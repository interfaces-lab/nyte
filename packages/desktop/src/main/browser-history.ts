/**
 * Pages a user visited in browser panels, per cookie jar: home, or one
 * workspace. The file sits in the app's user data beside the guest sessions it
 * pairs with, so clearing a jar's history and its cookies speak about the same
 * profile. Newest first, one entry per URL, at most `HISTORY_LIMIT` per owner.
 *
 * Changes run one at a time against the history as it stands after every
 * earlier change, and each lands on disk through a renamed temporary file. A
 * file that cannot be read or parsed reads as no history.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { BrowserHistoryEntry } from "@nyte-ai/app/bridge.ts";
import type { BrowserOwner } from "./browser-agent.ts";

export const HISTORY_LIMIT = 200;

const entryType = Type.Object({
  url: Type.String({ pattern: "^https?://" }),
  title: Type.String(),
  visitedAt: Type.Integer({ minimum: 0 }),
  visits: Type.Integer({ minimum: 1 }),
});

const historyFile = Compile(
  Type.Object({
    home: Type.Array(entryType),
    projects: Type.Record(Type.String(), Type.Array(entryType)),
  }),
);

type History = Map<string | null, readonly BrowserHistoryEntry[]>;

type Change = (
  entries: readonly BrowserHistoryEntry[],
) => readonly BrowserHistoryEntry[] | undefined;

function ownerKey(owner: BrowserOwner): string | null {
  return owner.kind === "home" ? null : owner.path;
}

export class BrowserHistoryStore {
  private readonly path: string;
  private loaded: Promise<History> | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async entries(owner: BrowserOwner): Promise<readonly BrowserHistoryEntry[]> {
    return (await this.read()).get(ownerKey(owner)) ?? [];
  }

  /** A visit moves the URL to the front; a title it already had survives a reload that has none yet. */
  record(
    owner: BrowserOwner,
    visit: { readonly url: string; readonly title?: string; readonly at: number },
  ): Promise<readonly BrowserHistoryEntry[] | undefined> {
    return this.update(owner, (entries) => {
      const previous = entries.find((entry) => entry.url === visit.url);

      const entry = {
        url: visit.url,
        title: visit.title ?? previous?.title ?? "",
        visitedAt: visit.at,
        visits: (previous?.visits ?? 0) + 1,
      };

      return [entry, ...entries.filter((item) => item.url !== visit.url)].slice(0, HISTORY_LIMIT);
    });
  }

  retitle(
    owner: BrowserOwner,
    page: { readonly url: string; readonly title: string },
  ): Promise<readonly BrowserHistoryEntry[] | undefined> {
    return this.update(owner, (entries) =>
      entries.some((entry) => entry.url === page.url && entry.title !== page.title)
        ? entries.map((entry) => (entry.url === page.url ? { ...entry, title: page.title } : entry))
        : undefined,
    );
  }

  remove(owner: BrowserOwner, url: string): Promise<readonly BrowserHistoryEntry[] | undefined> {
    return this.update(owner, (entries) =>
      entries.some((entry) => entry.url === url)
        ? entries.filter((entry) => entry.url !== url)
        : undefined,
    );
  }

  clear(owner: BrowserOwner): Promise<readonly BrowserHistoryEntry[] | undefined> {
    return this.update(owner, (entries) => (entries.length === 0 ? undefined : []));
  }

  /** Resolves with the owner's new entries, or undefined when nothing changed. */
  private update(
    owner: BrowserOwner,
    change: Change,
  ): Promise<readonly BrowserHistoryEntry[] | undefined> {
    const run = this.tail.then(async () => {
      const history = await this.read();
      const key = ownerKey(owner);
      const next = change(history.get(key) ?? []);

      if (next === undefined) return undefined;

      if (next.length === 0) history.delete(key);
      else history.set(key, next);

      await this.persist(history).catch(() => undefined);

      return next;
    });

    this.tail = run.catch(() => undefined);

    return run;
  }

  private read(): Promise<History> {
    this.loaded ??= this.load();

    return this.loaded;
  }

  private async load(): Promise<History> {
    try {
      const file = historyFile.Parse(JSON.parse(await readFile(this.path, "utf8")));

      return new Map<string | null, readonly BrowserHistoryEntry[]>([
        [null, file.home.slice(0, HISTORY_LIMIT)],
        ...Object.entries(file.projects).map(
          ([path, entries]) => [path, entries.slice(0, HISTORY_LIMIT)] as const,
        ),
      ]);
    } catch {
      return new Map();
    }
  }

  private async persist(history: History): Promise<void> {
    const projects = Object.fromEntries(
      [...history].filter(
        (item): item is [string, readonly BrowserHistoryEntry[]] => item[0] !== null,
      ),
    );

    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify({ home: history.get(null) ?? [], projects }), {
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}
