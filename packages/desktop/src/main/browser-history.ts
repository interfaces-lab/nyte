/**
 * Pages a user visited in browser panels, per cookie jar: home, or one
 * workspace. The file sits in the app's user data beside the guest sessions it
 * pairs with, so clearing a jar's history and its cookies speak about the same
 * profile. Newest first, one entry per URL, at most `HISTORY_LIMIT` per owner.
 *
 * Changes run one at a time against the history as it stands after every
 * earlier change. Visits change memory at once; the file and listeners follow
 * within one write window. A removal or clear lands on disk before memory takes
 * it, so a failed write rejects and changes nothing. Every write replaces the
 * whole file through a renamed temporary file, and a failed one is retried by
 * the next. A file that cannot be read or parsed reads as no history.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { BrowserHistoryEntry } from "@nyte-ai/app/bridge.ts";
import type { BrowserOwner } from "./browser-agent.ts";
import { retainDiagnostic } from "./errors.ts";

export const HISTORY_LIMIT = 200;

export const TITLE_LIMIT = 300;

/** A longer address is not remembered at all; a cut one would open a different page. */
export const URL_LIMIT = 2048;

const WRITE_DELAY = 2000;

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

type Writer = (path: string, contents: string) => Promise<void>;

type Listener = (owner: string | null, entries: readonly BrowserHistoryEntry[]) => void;

function ownerKey(owner: BrowserOwner): string | null {
  return owner.kind === "home" ? null : owner.path;
}

function assign(history: History, key: string | null, entries: readonly BrowserHistoryEntry[]) {
  if (entries.length === 0) history.delete(key);
  else history.set(key, entries);
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

export class BrowserHistoryStore {
  private readonly path: string;
  private readonly write: Writer;
  private readonly delay: number;
  private loaded: Promise<History> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  /** Memory holds changes the file lacks. */
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Owners whose entries changed since the listener last heard. */
  private readonly unpublished = new Set<string | null>();
  private listener: Listener = () => undefined;

  constructor(path: string, options: { readonly write?: Writer; readonly delay?: number } = {}) {
    this.path = path;
    this.write = options.write ?? writeAtomically;
    this.delay = options.delay ?? WRITE_DELAY;
  }

  /** Hears an owner's entries at most once per write window, and once a removal or clear lands. */
  listen(listener: Listener): void {
    this.listener = listener;
  }

  async entries(owner: BrowserOwner): Promise<readonly BrowserHistoryEntry[]> {
    return (await this.read()).get(ownerKey(owner)) ?? [];
  }

  /** A visit moves the URL to the front; a title it already had survives a reload that has none yet. */
  record(
    owner: BrowserOwner,
    visit: { readonly url: string; readonly title?: string; readonly at: number },
  ): Promise<void> {
    if (visit.url.length > URL_LIMIT) return Promise.resolve();

    return this.change(owner, (entries) => {
      const previous = entries.find((entry) => entry.url === visit.url);

      const entry = {
        url: visit.url,
        title: visit.title?.slice(0, TITLE_LIMIT) ?? previous?.title ?? "",
        visitedAt: visit.at,
        visits: (previous?.visits ?? 0) + 1,
      };

      return [entry, ...entries.filter((item) => item.url !== visit.url)].slice(0, HISTORY_LIMIT);
    });
  }

  retitle(
    owner: BrowserOwner,
    page: { readonly url: string; readonly title: string },
  ): Promise<void> {
    const title = page.title.slice(0, TITLE_LIMIT);

    return this.change(owner, (entries) =>
      entries.some((entry) => entry.url === page.url && entry.title !== title)
        ? entries.map((entry) => (entry.url === page.url ? { ...entry, title } : entry))
        : undefined,
    );
  }

  remove(owner: BrowserOwner, url: string): Promise<void> {
    return this.commit(owner, (entries) =>
      entries.some((entry) => entry.url === url)
        ? entries.filter((entry) => entry.url !== url)
        : undefined,
    );
  }

  clear(owner: BrowserOwner): Promise<void> {
    return this.commit(owner, (entries) => (entries.length === 0 ? undefined : []));
  }

  /** Writes pending visits now. A failure is kept as a diagnostic and the next write retries it. */
  flush(): Promise<void> {
    return this.queue(async () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      const history = await this.read();
      this.publish(history);

      if (this.dirty) await this.save(history);
    }).catch((cause: unknown) => retainDiagnostic({ correlationId: "browser-history", cause }));
  }

  private change(owner: BrowserOwner, change: Change): Promise<void> {
    return this.queue(async () => {
      const history = await this.read();
      const key = ownerKey(owner);
      const next = change(history.get(key) ?? []);

      if (next === undefined) return;
      assign(history, key, next);
      this.dirty = true;
      this.unpublished.add(key);
      this.timer ??= setTimeout(() => void this.flush(), this.delay);
    });
  }

  private commit(owner: BrowserOwner, change: Change): Promise<void> {
    return this.queue(async () => {
      const history = await this.read();
      const key = ownerKey(owner);
      const next = change(history.get(key) ?? []);

      if (next === undefined) return;
      const updated = new Map(history);
      assign(updated, key, next);
      await this.save(updated);
      assign(history, key, next);
      this.unpublished.add(key);
      this.publish(history);
    });
  }

  private queue(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);

    return run;
  }

  private publish(history: History): void {
    for (const key of this.unpublished) this.listener(key, history.get(key) ?? []);
    this.unpublished.clear();
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

  private async save(history: History): Promise<void> {
    const projects = Object.fromEntries(
      [...history].filter(
        (item): item is [string, readonly BrowserHistoryEntry[]] => item[0] !== null,
      ),
    );

    await this.write(this.path, JSON.stringify({ home: history.get(null) ?? [], projects }));
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty = false;
  }
}
