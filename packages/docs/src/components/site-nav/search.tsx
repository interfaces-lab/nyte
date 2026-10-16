import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { create } from "@stylexjs/stylex";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Input } from "@nyte-ai/ui/input";
import { splitHref } from "~/lib/href";

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
  if (!Array.isArray(value)) return [];
  const results: Result[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, type, content, url } = entry;
    if (typeof id !== "string" || typeof content !== "string" || typeof url !== "string") continue;
    if (type !== "page" && type !== "heading" && type !== "text") continue;
    results.push({ id, type, content, url });
  }
  return results;
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

/*
 * ⌘K over the shared /api/search index, drawn with the shared Dialog and
 * Input. Results outside the current section are kept: an agent searching
 * "subagent" should find the core docs too.
 */
export function SiteSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<{ query: string; results: Result[] } | null>(null);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const listId = useId();
  const trimmed = query.trim();
  const results = trimmed === "" ? [] : (response?.results ?? []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || trimmed === "") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const body: unknown = await fetch(`/api/search?query=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (controller.signal.aborted) return;
      setResponse({ query: trimmed, results: parseResults(body) });
      setActive(0);
    }, 89);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, trimmed]);

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
      setOpen(false);
      // A result on the other host (docs from design.nyte.sh, or back) needs a full load.
      const next = splitHref(target.url);
      void router.navigate({ ...next, reloadDocument: router.buildLocation(next).external });
    }
  };

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
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup aria-label="Search" xstyle={styles.popup}>
          <Input
            autoFocus
            variant="bare"
            className="min-h-12 px-4 text-[15px]"
            placeholder="Search docs"
            aria-label="Search"
            aria-controls={listId}
            value={query}
            onKeyDown={onKeyDown}
            onValueChange={setQuery}
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
                    onClick={() => setOpen(false)}
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
          ) : response?.query === trimmed && trimmed !== "" ? (
            <div className="border-t border-border-subtle px-4 py-6 text-center text-sm text-muted-foreground">
              No results. Try a function or ref name.
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}
