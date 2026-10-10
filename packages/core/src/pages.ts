import { asId, asSeq } from "@nyte-ai/schema";
import type {
  BackgroundItem,
  CallId,
  HeadName,
  PageId,
  PageInfo,
  SessionId,
} from "@nyte-ai/schema";
import type { BrowserApi, Page } from "./browser.ts";
import { recordAcquisition, recordedAcquisition } from "./durable.ts";
import type { Kernel } from "./kernel.ts";

/** Names who takes a page hold: the session and head of the connection's origin, the step's call when it acts from one, and the counter its acquisitions key by (`acq:<n>`, §33a). Null for a client: its holds show on no head. */
export type PageHolder = {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly call: CallId | null;
  readonly sequence: { next(): number };
};

/** Holds the browser pages opened or adopted through this kernel, in memory, each with its holds: a page lives while any hold does, the last `close()` closing the provider's page. One per kernel (`kernel.pages`), built on first use. */
export interface PageTable {
  /** Takes one more hold on a provider page for a holder (recording the page on its first hold, titled `title`) and returns it: a `Page` that passes every member to the provider's page except `close()`, which releases this hold once. A holder's head shows the page as a `background` item (kind `page`, `working`) while it holds it, `done` once its last hold on the page is released; published unlogged (seq 0, §37c). */
  hold(page: Page, title: string, holder: PageHolder | null): Page;
  /** Returns the provider page the table holds under an id, or undefined. */
  page(id: PageId): Page | undefined;
  /** Returns how many holds a page has; 0 when the table does not hold it. */
  holders(id: PageId): number;
  /** Returns the background items of the pages a session's heads hold now, each with its head: what a cold fold seeds after its log (§37c). */
  background(
    session: SessionId,
  ): readonly { readonly head: HeadName; readonly item: BackgroundItem }[];
}

/** Returns one page the table holds: the provider's page, its title, its hold count and the holds per head. */
interface Entry {
  readonly page: Page;
  readonly title: string;
  holds: number;
  readonly heads: Map<string, { readonly holder: PageHolder; count: number }>;
}

/** Returns an empty page table over a kernel: what `kernel.pages` holds, built on first use once the kernel object exists. */
export function createPageTable(kernel: Kernel): PageTable {
  const entries = new Map<PageId, Entry>();

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

/** Returns a provider's browser with every page held through `kernel.pages` for `holder` (§37i). `open` from a durable step (a holder with a call) is an acquisition keyed `acq:<n>` (§33a): a re-run adopts the page the step recorded, and a page that lost the record to a concurrent run is closed for the winner; otherwise it opens a provider page. `adopt` holds the page the table already holds under that id, else the provider's `adopt`. `list` and `watch` report the table's hold count as `holders` for each page it holds. */
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
      const step =
        holder === null || holder.call === null
          ? null
          : { session: holder.session, call: holder.call };

      if (step === null || holder === null)
        return kernel.pages.hold(await browser.open(input), input.url, holder);
      const key = `acq:${holder.sequence.next()}`;
      const recorded = await recordedAcquisition(kernel, step, key);

      if (typeof recorded === "string") return adopt(asId<"page">(recorded), input.url);
      const page = await browser.open(input);
      const winner = await recordAcquisition(kernel, step, key, page.id);

      if (typeof winner !== "string" || winner === page.id)
        return kernel.pages.hold(page, input.url, holder);
      await page.close();

      return adopt(asId<"page">(winner), input.url);
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
