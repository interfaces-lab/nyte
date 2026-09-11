import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, test, vi } from "vitest";
import type { ComponentProps } from "react";
import type { WorkspaceSearchResult } from "../../../shared/workspace-editor.ts";
import { WorkspaceSearch, WorkspaceSearchResults } from "./workspace-search.tsx";

// The Electron preload is absent in Node. React, styles and query observers run unchanged.
vi.hoisted(() => vi.stubGlobal("window", { nyte: {} }));
afterAll(() => vi.unstubAllGlobals());

function renderResults(state: ComponentProps<typeof WorkspaceSearchResults>["state"]): string {
  return renderToStaticMarkup(<WorkspaceSearchResults state={state} onOpen={() => undefined} />);
}

const result: WorkspaceSearchResult = {
  files: [
    {
      path: "/workspace/src/hello.ts",
      displayPath: "src/hello.ts",
      source: "disk",
      matches: [
        { line: 8, column: 15, length: 5, snippet: 'const name = "Hello";', snippetColumn: 1 },
        { line: 12, column: 9, length: 5, snippet: 'return "hello";', snippetColumn: 1 },
      ],
    },
    {
      path: "/workspace/test/hello.ts",
      displayPath: "test/hello.ts",
      source: "draft",
      matches: [{ line: 3, column: 4, length: 5, snippet: "// HELLO", snippetColumn: 1 }],
    },
  ],
  matchCount: 3,
  truncated: false,
  skipped: { binary: 0, tooLarge: 0, unreadable: 0 },
};

test("search starts idle with named matching controls and no replace or ignore override", () => {
  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <WorkspaceSearch onOpen={() => undefined} />
      </QueryClientProvider>,
    );
    assert.match(html, /<input[^>]*aria-label="Search workspace"/);
    for (const label of ["Match case", "Match whole word", "Use regular expression"]) {
      assert.match(html, new RegExp(`<button[^>]*aria-label="${label}"[^>]*aria-pressed="false"`));
    }
    assert.match(html, /<button[^>]*aria-label="Search filters"[^>]*aria-expanded="false"/);
    assert.match(html, /Files to include/);
    assert.match(html, /Files to exclude/);
    assert.match(html, /Search file contents across your workspace/);
    assert.doesNotMatch(html, /Searching…|No matches found|[Rr]eplace|Respect ignore files/);
  } finally {
    client.clear();
  }
});

test("results are grouped by relative path with accessible line and column destinations", () => {
  const html = renderResults({ kind: "ready", result });
  assert.match(html, /3 matches in 2 files/);
  assert.equal((html.match(/<section aria-label="src\/hello.ts"/g) ?? []).length, 1);
  assert.equal((html.match(/<section aria-label="test\/hello.ts"/g) ?? []).length, 1);
  assert.match(html, /<button[^>]*aria-label="src\/hello.ts, line 8, column 15:/);
  assert.match(html, /<button[^>]*aria-label="src\/hello.ts, line 12, column 9:/);
  assert.match(html, /<button[^>]*aria-label="test\/hello.ts, line 3, column 4:/);
  assert.match(html, /Unsaved/);
  assert.doesNotMatch(html, /Search limit reached|files skipped/);
});

test("highlights preserve the actual matched case instead of substituting the query", () => {
  const html = renderResults({ kind: "ready", result });
  assert.deepEqual(
    [...html.matchAll(/<mark[^>]*>(.*?)<\/mark>/g)].map((match) => match[1]),
    ["Hello", "hello", "HELLO"],
  );
});

test("highlight offsets use UTF-16 columns relative to a bounded snippet", () => {
  const html = renderResults({
    kind: "ready",
    result: {
      ...result,
      matchCount: 1,
      files: [
        {
          path: "/workspace/long.ts",
          displayPath: "long.ts",
          source: "disk",
          matches: [
            {
              line: 42,
              column: 104,
              length: 7,
              snippet: "😀 foo1234 end",
              snippetColumn: 101,
            },
          ],
        },
      ],
    },
  });
  assert.match(html, /1 match in 1 file/);
  assert.match(html, /<mark[^>]*>foo1234<\/mark>/);
  assert.match(html.replace(/<[^>]*>/g, ""), /😀 foo1234 end/);
  assert.match(html, /line 42, column 104/);
});

test("zero-width regex matches have a visible marker without consuming snippet text", () => {
  const html = renderResults({
    kind: "ready",
    result: {
      ...result,
      matchCount: 1,
      files: [
        {
          path: "/workspace/empty.ts",
          displayPath: "empty.ts",
          source: "disk",
          matches: [{ line: 1, column: 1, length: 0, snippet: "hello", snippetColumn: 1 }],
        },
      ],
    },
  });
  assert.match(html, /<mark[^>]*aria-label="Zero-width match"[^>]*>\u200b<\/mark>/);
  assert.match(html.replace(/<[^>]*>/g, ""), /\u200bhello/);
});

test("file contents and transport errors are text, never executable markup", () => {
  const html = renderResults({
    kind: "ready",
    result: {
      ...result,
      matchCount: 1,
      files: [
        {
          path: "/workspace/example.html",
          displayPath: "example.html",
          source: "disk",
          matches: [
            {
              line: 1,
              column: 1,
              length: 8,
              snippet: "<script>alert(1)</script>",
              snippetColumn: 1,
            },
          ],
        },
      ],
    },
  });
  assert.match(html, /<mark[^>]*>&lt;script&gt;<\/mark>/);
  assert.doesNotMatch(html, /<script>/);
  const error = renderResults({ kind: "error", message: "Invalid regex: <script>" });
  assert.match(error, /role="alert"/);
  assert.match(error, /Invalid regex: &lt;script&gt;/);
  assert.doesNotMatch(error, /No matches found|<script>/);
});

test("idle, loading and completed empty states make different announcements", () => {
  assert.match(renderResults({ kind: "idle" }), /role="status"[^>]*>Search file contents/);
  const loading = renderResults({ kind: "loading" });
  assert.match(loading, /role="status"[^>]*>Searching…/);
  assert.doesNotMatch(loading, /No matches/);
  const empty = renderResults({ kind: "ready", result: { ...result, files: [], matchCount: 0 } });
  assert.match(empty, /role="status"[^>]*>No matches found\./);
  assert.doesNotMatch(empty, /Searching…/);
});

test("partial results and skipped files never claim a complete workspace search", () => {
  const html = renderResults({
    kind: "ready",
    result: { ...result, truncated: true, skipped: { binary: 2, tooLarge: 1, unreadable: 1 } },
  });
  assert.match(html, /3 matches in 2 files/);
  assert.match(html, /Search limit reached. Narrow your query or filters/);
  assert.match(html, /4 files skipped: binary, too large, or unreadable/);
  assert.match(html, /<mark[^>]*>Hello<\/mark>/);
  const empty = renderResults({
    kind: "ready",
    result: { ...result, files: [], matchCount: 0, truncated: true },
  });
  assert.match(empty, /No matches found before the search limit/);
  assert.doesNotMatch(empty, /No matches found\./);
});
