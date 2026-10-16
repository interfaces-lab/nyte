import { asId, asSeq } from "@nyte-ai/schema";
import type { BackgroundItem, ObjectId, PageId, PageInfo } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { BrowserApi, Page, PageHolder, PageTable } from "../contract/workspace.ts";
import { acquire } from "../engine/jobs.ts";
import { objectId } from "../util/content.ts";
import { SdkError } from "../util/error.ts";

const OPENED_IDS = 256;

interface Entry {
  readonly page: Page;
  readonly title: string;
  holds: number;
  readonly heads: Map<string, { readonly holder: Origin; count: number }>;
}

type Origin = NonNullable<PageHolder["origin"]>;

export function createPageTable(kernel: Kernel): PageTable {
  const entries = new Map<PageId, Entry>();
  const held = new Map<() => Promise<void>, PageHolder | null>();

  const opened = new Map<
    string,
    { readonly page: Promise<Page>; readonly digest: Promise<ObjectId> }
  >();

  const createPageBackgroundItem = (
    entry: Entry,
    holder: Origin,
    state: BackgroundItem["state"],
  ): BackgroundItem => ({
    kind: "page",
    id: entry.page.id,
    title: entry.title,
    state,
    startedBy: holder.call,
  });

  const publish = (entry: Entry, holder: Origin, state: BackgroundItem["state"]): void => {
    kernel.bus.publish(holder.session, {
      seq: asSeq(0),
      at: Date.now(),
      head: holder.head,
      kind: "background",
      item: createPageBackgroundItem(entry, holder, state),
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
      const origin = holder?.origin ?? null;
      const key = origin === null ? null : JSON.stringify([origin.session, origin.head]);
      const known = key === null ? undefined : entry.heads.get(key);

      if (known !== undefined) known.count += 1;
      else if (key !== null && origin !== null) {
        entry.heads.set(key, { holder: origin, count: 1 });
        publish(entry, origin, "working");
      }

      let released = false;

      const release = async (): Promise<void> => {
        if (released) return;
        released = true;
        held.delete(release);
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

      held.set(release, holder);

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
    async release(by) {
      const matches = (holder: PageHolder | null): boolean =>
        "client" in by
          ? holder?.client === by.client
          : "run" in by
            ? holder?.origin?.run === by.run
            : holder?.origin?.session === by.session;

      await Promise.allSettled(
        [...held].flatMap(([release, holder]) => (matches(holder) ? [release()] : [])),
      );
    },
    background: (session) =>
      [...entries.values()].flatMap((entry) =>
        [...entry.heads.values()].flatMap(({ holder }) =>
          holder.session === session
            ? [{ head: holder.head, item: createPageBackgroundItem(entry, holder, "working") }]
            : [],
        ),
      ),
  };
}

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
        holder?.origin ?? null,
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
