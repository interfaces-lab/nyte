import { Link, useRouter } from "@tanstack/react-router";
import { useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { create } from "@stylexjs/stylex";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Input } from "@nyte-ai/ui/input";
import { liteClient } from "algoliasearch/lite";
import { glyphs } from "~/lib/glyphs";
import { algoliaClient } from "fumadocs-core/search/client/algolia";
import { splitHref } from "~/lib/href";

const { IconMagnifyingGlass } = glyphs;

const styles = create({
  popup: {
    gap: 0,
    top: "min(20dvh, 160px)",
    width: "min(610px, calc(100vw - 48px))",
    maxHeight: "calc(100dvh - min(20dvh, 160px) - 24px)",
    padding: 0,
    transform: "translate(-50%, 0)",
  },
});

interface Result {
  id: string;
  type: "page" | "heading" | "text";
  content: string;
  url: string;
}

function parseResults(value: unknown): Result[] {
  if (!Array.isArray(value)) throw new Error("Search returned an invalid response.");

  return value.map((entry: unknown): Result => {
    if (typeof entry !== "object" || entry === null)
      throw new Error("Search returned an invalid result.");
    if (
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !("content" in entry) ||
      typeof entry.content !== "string" ||
      !("url" in entry) ||
      typeof entry.url !== "string" ||
      !("type" in entry) ||
      (entry.type !== "page" && entry.type !== "heading" && entry.type !== "text")
    )
      throw new Error("Search returned an invalid result.");

    return { id: entry.id, type: entry.type, content: entry.content, url: entry.url };
  });
}

const { VITE_ALGOLIA_APP_ID: appId, VITE_ALGOLIA_SEARCH_KEY: searchKey } = import.meta.env;

const algolia =
  appId && searchKey
    ? algoliaClient({
        indexName: import.meta.env.VITE_ALGOLIA_INDEX ?? "docs",
        client: liteClient(appId, searchKey),
      })
    : null;

async function searchSite(query: string, signal: AbortSignal): Promise<Result[]> {
  if (algolia) return parseResults(await algolia.search(query));

  const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error(`Search request failed (HTTP ${response.status}).`);
  const body: unknown = await response.json();

  return parseResults(body);
}

function Highlighted({ content }: { content: string }) {
  return content.split(/<\/?mark>/).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="bg-transparent font-medium text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function SiteSearch() {
  const [open, setOpen] = useState(false);

  useSearchShortcut(setOpen);

  return (
    <>
      <button
        type="button"
        className="inline-flex h-(--site-nav-control) cursor-pointer items-center justify-center rounded-full bg-fill-selected px-3.5 text-[15px] font-medium text-foreground max-lg:hidden hero:bg-white/12 hero:text-white hero:hover:bg-white/20"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <span>Search</span>
      </button>
      <button
        type="button"
        className="hidden size-(--site-nav-control) cursor-pointer items-center justify-center rounded-full bg-fill-selected text-foreground hover:bg-foreground/10 max-lg:inline-flex hero:text-white"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <IconMagnifyingGlass size={16} />
      </button>
      <SearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function useSearchShortcut(setOpen: Dispatch<SetStateAction<boolean>>) {
  useMountEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup aria-label="Search" xstyle={styles.popup}>
        <SearchContent onClose={() => onOpenChange(false)} />
      </Dialog.Popup>
    </Dialog.Root>
  );
}

type SearchState =
  | { status: "idle" | "pending" | "error" }
  | { status: "ready"; query: string; results: Result[] };

function SearchContent({ onClose }: { readonly onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchState>({ status: "idle" });
  const [active, setActive] = useState(0);
  const router = useRouter();
  const listId = useId();
  const trimmed = query.trim();
  const results = response.status === "ready" && response.query === trimmed ? response.results : [];
  const pending = useRef<AbortController | null>(null);

  useMountEffect(() => () => pending.current?.abort());

  const search = (value: string) => {
    setQuery(value);
    const next = value.trim();
    pending.current?.abort();
    pending.current = null;
    setActive(0);
    if (next === "") {
      setResponse({ status: "idle" });
      return;
    }
    setResponse({ status: "pending" });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const found = await searchSite(next, controller.signal);

        if (controller.signal.aborted) return;
        setResponse({ status: "ready", query: next, results: found });
      } catch {
        if (!controller.signal.aborted) setResponse({ status: "error" });
      }
    }, 89);
    controller.signal.addEventListener("abort", () => clearTimeout(timer));
    pending.current = controller;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, Math.max(0, results.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      const target = results[active];
      if (!target) return;
      event.preventDefault();
      onClose();
      const next = splitHref(target.url);
      const onOtherHost = router.buildLocation(next).external;
      void router.navigate({ ...next, reloadDocument: onOtherHost });
    }
  };

  const message =
    response.status === "pending"
      ? `Searching for “${trimmed}”…`
      : response.status === "error"
        ? "Search couldn’t load. Check your connection, then retry the search."
        : response.status === "ready" && results.length === 0
          ? `No results for “${trimmed}”. Try another term or clear the search.`
          : "";

  return (
    <>
      <Input
        autoFocus
        variant="bare"
        className="min-h-12 px-4 text-[15px]"
        placeholder="install"
        aria-label="Search"
        aria-controls={listId}
        value={query}
        onKeyDown={onKeyDown}
        onValueChange={search}
      />
      {results.length > 0 ? (
        <ul
          id={listId}
          className="max-h-90 overflow-y-auto border-t border-border-subtle p-2"
          role="listbox"
        >
          {results.map((result, index) => (
            <li key={result.id} role="option" aria-selected={index === active}>
              <Link
                {...splitHref(result.url)}
                data-type={result.type}
                className="flex flex-col gap-0.5 rounded-lg px-3 py-2 text-sm/5 not-data-[type=page]:pl-6 not-data-[type=page]:text-muted-foreground hover:bg-fill-hover data-active:bg-fill-selected data-[type=page]:font-medium"
                data-active={index === active || undefined}
                onClick={onClose}
                onMouseEnter={() => setActive(index)}
              >
                <span>
                  <Highlighted content={result.content} />
                </span>
                {result.type === "page" && (
                  <small className="text-xs/5 text-muted-foreground">{result.url}</small>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className={
          message === ""
            ? "sr-only"
            : "border-t border-border-subtle px-4 py-6 text-center text-sm text-muted-foreground"
        }
      >
        <p role="status">{message}</p>
        {response.status === "error" ? (
          <button
            type="button"
            className="mt-3 cursor-pointer font-medium text-foreground underline underline-offset-4"
            onClick={() => search(query)}
          >
            Retry search
          </button>
        ) : null}
      </div>
      {algolia ? (
        <a
          href="https://www.algolia.com/?utm_medium=referral&utm_source=nyte-docs"
          target="_blank"
          rel="noreferrer"
          className="border-t border-border-subtle px-4 py-2 text-right text-xs/5 text-muted-foreground hover:text-foreground"
        >
          Search by Algolia
        </a>
      ) : null}
    </>
  );
}
