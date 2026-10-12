import { asId, asSeq } from "@nyte-ai/schema";
import type {
  BackgroundItem,
  ByteReader,
  CallId,
  ConsoleEntry,
  DocumentRevision,
  HeadName,
  Json,
  ObjectId,
  PageId,
  PageInfo,
  PageOutcome,
  PageSnapshot,
  PageView,
  SessionId,
} from "@nyte-ai/schema";
import { objectId } from "./content.ts";
import { SdkError } from "./error.ts";
import { acquire } from "./jobs.ts";
import type { Kernel } from "./kernel.ts";

export interface BrowserApi {
  open(input: { readonly url: string }): Promise<Page>;
  adopt(id: PageId): Promise<Page>;
  list(): Promise<readonly PageInfo[]>;
  watch(): AsyncIterable<readonly PageInfo[]>;
}

export interface Page {
  readonly id: PageId;
  view(): Promise<PageView>;
  watch(): AsyncIterable<PageView>;
  snapshot(input?: { readonly ref?: string }): Promise<PageSnapshot>;
  navigate(url: string): Promise<PageOutcome>;
  back(): Promise<PageOutcome>;
  forward(): Promise<PageOutcome>;
  reload(): Promise<PageOutcome>;
  stopLoading(): Promise<PageOutcome>;
  click(input: {
    readonly ref: string;
    readonly button?: "left" | "right" | "middle";
    readonly double?: boolean;
    readonly expect?: DocumentRevision;
  }): Promise<PageOutcome>;
  type(input: {
    readonly ref: string;
    readonly text: string;
    readonly clear?: boolean;
    readonly submit?: boolean;
    readonly expect?: DocumentRevision;
  }): Promise<PageOutcome>;
  press(input: { readonly key: string; readonly ref?: string }): Promise<PageOutcome>;
  scroll(input: {
    readonly direction: "up" | "down" | "top" | "bottom";
    readonly ref?: string;
    readonly pages?: number;
  }): Promise<PageOutcome>;
  wait(
    condition:
      | { readonly kind: "loaded" }
      | { readonly kind: "text"; readonly text: string; readonly present: boolean }
      | { readonly kind: "delay"; readonly ms: number },
  ): Promise<PageOutcome>;
  console(input?: {
    readonly limit?: number;
    readonly clear?: boolean;
  }): Promise<readonly ConsoleEntry[]>;
  capture(): Promise<ByteReader>;
  evaluate(
    expression: string,
    options?: { readonly ref?: string },
  ): Promise<
    | { readonly kind: "value"; readonly value: Json }
    | { readonly kind: "threw"; readonly message: string }
  >;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

const OPENED_IDS = 256;

/** Names who takes a page hold: the origin's session and head, its step's call and acquisition counter (§33a); null for a client. */
export type PageHolder = {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly call: CallId | null;
  readonly sequence: { next(): number };
};

/** Holds the browser pages opened or adopted through this kernel, in memory: a page lives while any hold does, and a holder's head shows it as an unlogged `background` item (§37c). */
export interface PageTable {
  /** Takes one more hold on a provider page; the returned page's `close()` releases this hold once, the last one closing the provider's page. */
  hold(page: Page, title: string, holder: PageHolder | null): Page;
  /** Runs `open` once per `id`: a replay with the same input returns the same page (§40e), another input throws `invalid` (§40x), and a replay after the page closed throws `unknown`, the digest kept (G6). */
  open(request: {
    readonly id?: string;
    readonly input: Json;
    open(): Promise<Page>;
  }): Promise<Page>;
  page(id: PageId): Page | undefined;
  holders(id: PageId): number;
  background(
    session: SessionId,
  ): readonly { readonly head: HeadName; readonly item: BackgroundItem }[];
}

/** Returns one page the table holds, with its holds per head. */
interface Entry {
  readonly page: Page;
  readonly title: string;
  holds: number;
  readonly heads: Map<string, { readonly holder: PageHolder; count: number }>;
}

/** Returns an empty page table over a kernel. */
export function createPageTable(kernel: Kernel): PageTable {
  const entries = new Map<PageId, Entry>();

  const opened = new Map<
    string,
    { readonly page: Promise<Page>; readonly digest: Promise<ObjectId> }
  >();

  const itemOf = (
    entry: Entry,
    holder: PageHolder,
    state: BackgroundItem["state"],
  ): BackgroundItem => ({
    kind: "page",
    id: entry.page.id,
    title: entry.title,
    state,
    startedBy: holder.call,
  });

  const publish = (entry: Entry, holder: PageHolder, state: BackgroundItem["state"]): void => {
    kernel.bus.publish(holder.session, {
      seq: asSeq(0),
      at: Date.now(),
      head: holder.head,
      kind: "background",
      item: itemOf(entry, holder, state),
    });
  };

  return {
    async open(request) {
      const key = request.id;

      if (key === undefined) return request.open();
      const digest = objectId(request.input);
      const known = opened.get(key);

      if (known === undefined) {
        const page = request.open();
        opened.set(key, { page, digest });
        page.catch(() => opened.delete(key));

        for (const oldest of opened.keys()) {
          if (opened.size <= OPENED_IDS) break;
          opened.delete(oldest);
        }

        return page;
      }

      if ((await known.digest) !== (await digest))
        throw new SdkError("invalid", `The id ${key} already opened another page.`);
      const page = await known.page;

      if (!entries.has(page.id))
        throw new SdkError("unknown", `The page the id ${key} opened is closed.`);

      return page;
    },
    hold(page, title, holder) {
      const entry: Entry = entries.get(page.id) ?? { page, title, holds: 0, heads: new Map() };
      entries.set(page.id, entry);
      entry.holds += 1;
      const key = holder === null ? null : JSON.stringify([holder.session, holder.head]);
      const held = key === null ? undefined : entry.heads.get(key);

      if (held !== undefined) held.count += 1;
      else if (key !== null && holder !== null) {
        entry.heads.set(key, { holder, count: 1 });
        publish(entry, holder, "working");
      }

      let released = false;

      const release = async (): Promise<void> => {
        if (released) return;
        released = true;
        entry.holds -= 1;
        const head = key === null ? undefined : entry.heads.get(key);

        if (head !== undefined && key !== null) {
          head.count -= 1;

          if (head.count === 0) {
            entry.heads.delete(key);
            publish(entry, head.holder, "done");
          }
        }

        if (entry.holds > 0) return;

        if (entries.get(entry.page.id) === entry) entries.delete(entry.page.id);
        await entry.page.close();
      };

      const inner = entry.page;

      return {
        id: inner.id,
        view: () => inner.view(),
        watch: () => inner.watch(),
        snapshot: (input) => inner.snapshot(input),
        navigate: (url) => inner.navigate(url),
        back: () => inner.back(),
        forward: () => inner.forward(),
        reload: () => inner.reload(),
        stopLoading: () => inner.stopLoading(),
        click: (input) => inner.click(input),
        type: (input) => inner.type(input),
        press: (input) => inner.press(input),
        scroll: (input) => inner.scroll(input),
        wait: (condition) => inner.wait(condition),
        console: (input) => inner.console(input),
        capture: () => inner.capture(),
        evaluate: (expression, options) => inner.evaluate(expression, options),
        close: release,
        [Symbol.asyncDispose]: release,
      };
    },
    page: (id) => entries.get(id)?.page,
    holders: (id) => entries.get(id)?.holds ?? 0,
    background: (session) =>
      [...entries.values()].flatMap((entry) =>
        [...entry.heads.values()].flatMap(({ holder }) =>
          holder.session === session
            ? [{ head: holder.head, item: itemOf(entry, holder, "working") }]
            : [],
        ),
      ),
  };
}

/** Returns a provider's browser with every page held through `kernel.pages` for `holder` (§37i); `open` from a step is an acquisition (`acquire`), a re-run adopting the recorded page. `list` and `watch` report the table's hold count as `holders`. */
export function wrapBrowser(
  kernel: Kernel,
  browser: BrowserApi,
  holder: PageHolder | null,
): BrowserApi {
  const adopt = async (id: PageId, title: string): Promise<Page> =>
    kernel.pages.hold(kernel.pages.page(id) ?? (await browser.adopt(id)), title, holder);

  const counted = (info: PageInfo): PageInfo =>
    kernel.pages.page(info.id) === undefined
      ? info
      : { ...info, holders: kernel.pages.holders(info.id) };

  return {
    async open(input) {
      const acquired = await acquire(
        kernel,
        holder,
        undefined,
        () => browser.open(input),
        (page) => page.close(),
      );

      return acquired.kind === "recorded"
        ? adopt(asId<"page">(acquired.id), input.url)
        : kernel.pages.hold(acquired.value, input.url, holder);
    },
    adopt: (id) => adopt(id, id),
    list: async () => (await browser.list()).map(counted),
    watch: () => countedPages(browser.watch(), counted),
  };
}

async function* countedPages(
  source: AsyncIterable<readonly PageInfo[]>,
  counted: (info: PageInfo) => PageInfo,
): AsyncGenerator<readonly PageInfo[]> {
  for await (const infos of source) yield infos.map(counted);
}
