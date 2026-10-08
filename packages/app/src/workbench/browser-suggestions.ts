import type { BrowserHistoryEntry } from "../bridge.ts";
import { parseWebUrl, resolveBrowserAddress, searchAddress } from "./browser-address.ts";

export interface BrowserSuggestion {
  readonly kind: "go" | "search" | "history" | "bookmark";
  readonly url: string;
  /** The text for go and search rows; the page title, possibly empty, for the rest. */
  readonly label: string;
}

export interface BrowserSuggestions {
  readonly rows: readonly BrowserSuggestion[];
  /** Follows the typed text in the field, selected, so typing on replaces it. Empty for none. */
  readonly completion: string;
}

interface Page {
  readonly url: string;
  readonly title: string;
}

const LIMIT = 8;

const DAY = 86_400_000;

/** Recent visits outweigh old ones; within an age, more visits rank higher. */
function frecency(entry: BrowserHistoryEntry, now: number): number {
  const age = now - entry.visitedAt;
  const weight = age < 4 * DAY ? 100 : age < 14 * DAY ? 70 : age < 31 * DAY ? 50 : 30;

  return entry.visits * weight;
}

/** What a person types for a page: no scheme, no `www.`, no slash after a bare host. */
function typedForms(url: URL): readonly string[] {
  const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  const bare = `${url.host}${rest}`;
  const forms = [bare, `${url.protocol}//${bare}`];

  return url.host.startsWith("www.") ? [`${url.host.slice(4)}${rest}`, ...forms] : forms;
}

/**
 * 0 for the address itself, 1 for one that starts with the text at its host,
 * 2 for one that contains it, 3 for a title. A trailing slash names the same page.
 */
function matchTier(row: BrowserSuggestion, query: string): number | undefined {
  let url: URL;

  try {
    url = new URL(row.url);
  } catch {
    return undefined;
  }

  const bare = query
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");

  const forms = typedForms(url).map((form) => form.toLowerCase());

  if (bare !== "" && forms.includes(bare)) return 0;

  if (bare !== "" && forms.some((form) => form.startsWith(bare))) return 1;

  if (bare !== "" && forms.some((form) => form.includes(bare))) return 2;

  return row.label.toLowerCase().includes(query) ? 3 : undefined;
}

/** The rest of the top match's address, when the text is how that address starts. */
function inlineCompletion(text: string, url: string): string {
  if (text === "" || /\s/.test(text)) return "";
  const typed = text.toLowerCase();

  const form = typedForms(new URL(url)).find((candidate) =>
    candidate.toLowerCase().startsWith(typed),
  );

  return form === undefined ? "" : form.slice(text.length);
}

/**
 * Address bar rows. With nothing typed, the most recent pages other than this
 * one. Otherwise the literal destination first, going to it ahead of searching
 * when the text reads as an address, then history and bookmarks that match:
 * the typed address itself, then addresses it starts at the host, then other
 * address matches, then titles, each by frecency. `complete` allows filling
 * in the top match's address, which a deletion must not bring straight back.
 */
export function browserSuggestions(input: {
  readonly text: string;
  readonly complete: boolean;
  readonly current: string;
  readonly history: readonly BrowserHistoryEntry[];
  readonly bookmarks: readonly Page[];
  readonly now: number;
}): BrowserSuggestions {
  const query = input.text.trim();

  if (query === "") {
    return {
      rows: input.history
        .flatMap((entry): BrowserSuggestion[] =>
          entry.url === input.current
            ? []
            : [{ kind: "history", url: entry.url, label: entry.title }],
        )
        .slice(0, LIMIT),
      completion: "",
    };
  }

  const lower = query.toLowerCase();
  const visited = new Set(input.history.map((entry) => entry.url));

  const pages: readonly { readonly row: BrowserSuggestion; readonly score: number }[] = [
    ...input.history.map((entry) => ({
      row: { kind: "history", url: entry.url, label: entry.title } as const,
      score: frecency(entry, input.now),
    })),
    ...input.bookmarks.flatMap((bookmark) =>
      visited.has(bookmark.url)
        ? []
        : [
            {
              row: { kind: "bookmark", url: bookmark.url, label: bookmark.title } as const,
              score: 0,
            },
          ],
    ),
  ];

  const candidates = pages
    .flatMap((page) => {
      const tier = matchTier(page.row, lower);

      return tier === undefined ? [] : [{ ...page, tier }];
    })
    .sort((a, b) => a.tier - b.tier || b.score - a.score);

  const top = candidates[0];

  const completion =
    input.complete && top !== undefined && top.tier <= 1
      ? inlineCompletion(input.text, top.row.url)
      : "";

  const resolved = resolveBrowserAddress(query) ?? searchAddress(query);
  const search: BrowserSuggestion = { kind: "search", url: searchAddress(query), label: query };
  const address = resolved === search.url ? undefined : resolved;
  const target = top !== undefined && completion !== "" ? top.row.url : address;
  const guess = target ?? (/\s/.test(query) ? undefined : parseWebUrl(`https://${query}`));

  const go: readonly BrowserSuggestion[] =
    guess === undefined ? [] : [{ kind: "go", url: guess, label: `${query}${completion}` }];

  const literal = target === undefined ? [search, ...go] : [...go, search];
  const shown = new Set(literal.map((row) => row.url));

  return {
    rows: [
      ...literal,
      ...candidates.map((candidate) => candidate.row).filter((row) => !shown.has(row.url)),
    ].slice(0, LIMIT),
    completion,
  };
}
