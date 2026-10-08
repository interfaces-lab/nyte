import { expect, test } from "vitest";
import type { BrowserHistoryEntry } from "../bridge.ts";
import { browserSuggestions } from "./browser-suggestions.ts";

const NOW = Date.UTC(2026, 0, 31);

const DAY = 86_400_000;

function visit(url: string, title: string, daysAgo: number, visits = 1): BrowserHistoryEntry {
  return { url, title, visitedAt: NOW - daysAgo * DAY, visits };
}

const HISTORY = [
  visit("https://docs.example.com/guide", "Guide", 0),
  visit("http://localhost:3000/", "Dev server", 1, 4),
  visit("https://www.github.com/nyte-ai/nyte", "Nyte repository", 2, 2),
  visit("https://news.ycombinator.com/", "Hacker News", 40, 1),
];

function suggest(text: string, complete = true) {
  return browserSuggestions({
    text,
    complete,
    accepted: undefined,
    current: "https://docs.example.com/guide",
    history: HISTORY,
    bookmarks: [{ url: "https://localbase.dev/", title: "Local base" }],
    now: NOW,
  });
}

test("typing a host prefix fills in the visited address and offers it first", () => {
  const { rows, completion } = suggest("local");

  expect(completion).toEqual({ text: "localhost:3000", url: "http://localhost:3000/" });
  expect(rows.slice(0, 3)).toEqual([
    { kind: "go", url: "http://localhost:3000/", label: "localhost:3000" },
    { kind: "search", url: "https://duckduckgo.com/?q=local", label: "local" },
    { kind: "bookmark", url: "https://localbase.dev/", label: "Local base" },
  ]);
});

test("a typed address that was visited wins over a busier page under it", () => {
  const { rows, completion } = browserSuggestions({
    text: "http://localhost:3000/",
    complete: true,
    accepted: undefined,
    current: "",
    history: [
      visit("http://localhost:3000/admin", "Admin", 0, 9),
      visit("http://localhost:3000/", "", 3),
    ],
    bookmarks: [],
    now: NOW,
  });

  expect(completion).toBeUndefined();
  expect(rows[0]).toEqual({
    kind: "go",
    url: "http://localhost:3000/",
    label: "http://localhost:3000/",
  });
});

test("a deletion does not bring the completion straight back", () => {
  const { rows, completion } = suggest("local", false);

  expect(completion).toBeUndefined();
  expect(rows[0]).toEqual({
    kind: "search",
    url: "https://duckduckgo.com/?q=local",
    label: "local",
  });
  expect(rows.map((row) => row.url)).toContain("http://localhost:3000/");
});

test("matches ignore the scheme, www, and case, and rank host prefixes before titles", () => {
  expect(suggest("GitHub.com/n").completion?.text).toBe("GitHub.com/nyte-ai/nyte");
  expect(suggest("HTTPS://www.git").rows[0]?.url).toBe("https://www.github.com/nyte-ai/nyte");

  expect(suggest("news").completion?.text).toBe("news.ycombinator.com");
  expect(suggest("ycombinator").rows.map((row) => [row.kind, row.url])).toEqual([
    ["search", "https://duckduckgo.com/?q=ycombinator"],
    ["go", "https://ycombinator/"],
    ["history", "https://news.ycombinator.com/"],
  ]);
  expect(suggest("repository").rows.at(-1)?.url).toBe("https://www.github.com/nyte-ai/nyte");
});

test("an address goes before a search, and a phrase only searches", () => {
  expect(suggest("example.org/a").rows.map((row) => row.kind)).toEqual(["go", "search"]);
  expect(suggest("dev server").rows.map((row) => [row.kind, row.url])).toEqual([
    ["search", "https://duckduckgo.com/?q=dev%20server"],
    ["history", "http://localhost:3000/"],
  ]);
});

test("an empty field lists recent pages other than the current one", () => {
  expect(suggest("").rows.map((row) => row.url)).toEqual([
    "http://localhost:3000/",
    "https://www.github.com/nyte-ai/nyte",
    "https://news.ycombinator.com/",
  ]);
});

test("an accepted completion opens the visited page, not its text read afresh", () => {
  const history = [
    visit("http://example.com/Path", "Plain", 0),
    visit("https://www.example.org/", "With www", 1),
  ];

  const accept = (text: string) => {
    const options = { current: "", history, bookmarks: [], now: NOW };

    const { completion } = browserSuggestions({
      ...options,
      text,
      complete: true,
      accepted: undefined,
    });

    return browserSuggestions({
      ...options,
      text: completion?.text ?? "",
      complete: false,
      accepted: completion,
    }).rows[0];
  };

  expect(accept("exam")).toEqual({
    kind: "go",
    url: "http://example.com/Path",
    label: "example.com/Path",
  });
  expect(accept("example.com/p")?.url).toBe("http://example.com/Path");
  expect(accept("example.o")?.url).toBe("https://www.example.org/");
});
