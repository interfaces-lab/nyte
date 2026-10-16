import type { BrowserHistoryEntry } from "../bridge.ts";
import { parseWebUrl, resolveBrowserAddress, searchAddress } from "./browser-address.ts";

export interface BrowserSuggestion {
  readonly kind: "go" | "search" | "history" | "bookmark";
  readonly url: string;
  readonly label: string;
}

export interface BrowserCompletion {
  readonly text: string;
  readonly url: string;
}

export interface BrowserSuggestions {
  readonly rows: readonly BrowserSuggestion[];
  readonly completion: BrowserCompletion | undefined;
}

interface Page {
  readonly url: string;
  readonly title: string;
}

const LIMIT = 8;

const DAY = 86_400_000;

function frecency(entry: BrowserHistoryEntry, now: number): number {
  const age = now - entry.visitedAt;
  const weight = age < 4 * DAY ? 100 : age < 14 * DAY ? 70 : age < 31 * DAY ? 50 : 30;

  return entry.visits * weight;
}

function typedForms(url: URL): readonly string[] {
  const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  const bare = `${url.host}${rest}`;
  const forms = [bare, `${url.protocol}//${bare}`];

  return url.host.startsWith("www.") ? [`${url.host.slice(4)}${rest}`, ...forms] : forms;
}

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

function inlineCompletion(text: string, url: string): BrowserCompletion | undefined {
  if (text === "" || /\s/.test(text)) return undefined;
  const typed = text.toLowerCase();

  const form = typedForms(new URL(url)).find((candidate) =>
    candidate.toLowerCase().startsWith(typed),
  );

  return form === undefined || form.length === text.length
    ? undefined
    : { text: `${text}${form.slice(text.length)}`, url };
}

export function browserSuggestions(input: {
  readonly text: string;
  readonly complete: boolean;
  readonly accepted: BrowserCompletion | undefined;
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
      completion: undefined,
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
      : undefined;

  const resolved = resolveBrowserAddress(query) ?? searchAddress(query);
  const search: BrowserSuggestion = { kind: "search", url: searchAddress(query), label: query };
  const address = resolved === search.url ? undefined : resolved;
  const accepted = input.accepted?.text === input.text ? input.accepted.url : undefined;
  const target = accepted ?? completion?.url ?? address;
  const guess = target ?? (/\s/.test(query) ? undefined : parseWebUrl(`https://${query}`));

  const go: readonly BrowserSuggestion[] =
    guess === undefined ? [] : [{ kind: "go", url: guess, label: completion?.text ?? query }];

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
