"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { create } from "@stylexjs/stylex";
import { Dialog, Input } from "@nyte-ai/ui";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";

const styles = create({
  popup: { gap: 0, width: "min(610px, calc(100vw - 48px))", padding: 0 },
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

/*
 * ⌘K over the shared /api/search index, drawn with the shared Dialog and
 * Input. Results outside the current section are kept: an agent searching
 * "subagent" should find the core docs too.
 */
export function SiteSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const listId = useId();

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
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const trimmed = query.trim();
      const response =
        trimmed === ""
          ? null
          : await fetch(`/api/search?query=${encodeURIComponent(trimmed)}`, {
              signal: controller.signal,
            }).catch(() => null);
      if (trimmed !== "" && !response?.ok) return;
      setResults(response ? parseResults(await response.json()) : []);
      setActive(0);
    }, 89);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      const target = results[active];
      if (!target) return;
      event.preventDefault();
      setOpen(false);
      router.push(target.url);
    }
  };

  return (
    <>
      <button
        type="button"
        className="inline-flex h-(--site-nav-control) cursor-pointer items-center justify-center rounded-(--nyte-radius-full) bg-(--nyte-bg-interactive-primary-translucent) px-3.5 text-[15px] font-medium text-(--nyte-content-primary) max-lg:hidden hero:bg-white/12 hero:text-white hero:hover:bg-white/20"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <span>Search</span>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup xstyle={styles.popup}>
          <Dialog.Title xstyle={srOnly}>Search</Dialog.Title>
          <Input
            autoFocus
            variant="bare"
            className="min-h-12 border-b border-b-(--nyte-border-secondary-translucent) px-4 text-[15px]"
            placeholder="Search Cloud and the docs"
            aria-label="Search"
            aria-controls={listId}
            value={query}
            onKeyDown={onKeyDown}
            onValueChange={setQuery}
          />
          {results.length > 0 ? (
            <ul id={listId} className="max-h-90 overflow-y-auto p-2" role="listbox">
              {results.map((result, index) => (
                <li key={result.id} role="option" aria-selected={index === active}>
                  <Link
                    href={result.url}
                    data-type={result.type}
                    className="flex flex-col gap-0.5 rounded-lg px-3 py-2 text-sm/5 not-data-[type=page]:pl-6 not-data-[type=page]:text-(--nyte-content-secondary) hover:bg-(--nyte-bg-hover) data-active:bg-(--nyte-bg-interactive-secondary-translucent) data-[type=page]:font-medium"
                    data-active={index === active || undefined}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setActive(index)}
                  >
                    {result.content}
                    {result.type === "page" && (
                      <small className="text-xs/5 text-(--nyte-content-secondary)">
                        {result.url}
                      </small>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-(--nyte-content-secondary)">
              {query.trim() === "" ? "Type to search" : "No results"}
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}
