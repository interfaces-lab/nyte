import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { serial } from "@nyte-ai/schema/serial";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { BrowserHistoryEntry } from "@nyte-ai/app/bridge.ts";
import type { BrowserOwner } from "./browser-agent.ts";
import { retainDiagnostic } from "./errors.ts";

export const HISTORY_LIMIT = 200;

export const TITLE_LIMIT = 300;

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
  private readonly writes = serial();
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly unpublished = new Set<string | null>();
  private listener: Listener = () => undefined;

  constructor(path: string, options: { readonly write?: Writer; readonly delay?: number } = {}) {
    this.path = path;
    this.write = options.write ?? writeAtomically;
    this.delay = options.delay ?? WRITE_DELAY;
  }

  listen(listener: Listener): void {
    this.listener = listener;
  }

  async entries(owner: BrowserOwner): Promise<readonly BrowserHistoryEntry[]> {
    return (await this.read()).get(ownerKey(owner)) ?? [];
  }

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

  flush(): Promise<void> {
    return this.writes
      .run(async () => {
        clearTimeout(this.timer);
        this.timer = undefined;
        const history = await this.read();
        this.publish(history);

        if (this.dirty) await this.save(history);
      })
      .catch((cause: unknown) => retainDiagnostic({ correlationId: "browser-history", cause }));
  }

  private change(owner: BrowserOwner, change: Change): Promise<void> {
    return this.writes.run(async () => {
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
    return this.writes.run(async () => {
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
