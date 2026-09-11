"use client";

import { IconMagnifyingGlass } from "central-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Dialog, DialogContent, DialogTitle, Input } from "@nyte-ai/ui";

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
 * ⌘K over the shared /api/search index, drawn with Cloud's own Dialog and
 * Input. Results outside /cloud are kept: an agent searching "subagent" should
 * find the core docs too.
 */
export function CloudSearch() {
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
      <button type="button" className="cloud-search-trigger" onClick={() => setOpen(true)}>
        <IconMagnifyingGlass size={14} />
        <span>Search</span>
        <span className="cloud-kbd">
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} style={{ padding: 0, maxWidth: 610, gap: 0 }}>
          <DialogTitle
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
            }}
          >
            Search
          </DialogTitle>
          <Input
            autoFocus
            className="cloud-search-input"
            placeholder="Search Cloud and the docs"
            aria-label="Search"
            aria-controls={listId}
            value={query}
            onKeyDown={onKeyDown}
            onValueChange={setQuery}
          />
          {results.length > 0 ? (
            <ul id={listId} className="cloud-search-list" role="listbox">
              {results.map((result, index) => (
                <li key={result.id} role="option" aria-selected={index === active}>
                  <Link
                    href={result.url}
                    data-type={result.type}
                    data-active={index === active || undefined}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setActive(index)}
                  >
                    {result.content}
                    {result.type === "page" && <small>{result.url}</small>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="cloud-search-empty">
              {query.trim() === "" ? "Type to search" : "No results"}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
