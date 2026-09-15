/**
 * A turn row is keyed by file path, but one file edited twice in a turn arrives
 * as two diffs under that path. Pierre's singular components throw on anything
 * but one file, and nothing above this renders an error boundary, so a throw
 * here takes the workbench down rather than degrading one row.
 */
import { afterAll, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePatchFiles } from "@pierre/diffs";
import { DiffView } from "./diff-view.tsx";
import { parseUnifiedPatch } from "./tool-detail.ts";

vi.hoisted(() => {
  const query = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => {} } },
    matchMedia: () => query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const styleHost = { insertBefore: () => {}, appendChild: () => {}, firstChild: null };
  vi.stubGlobal("document", {
    documentElement: { dataset: {}, style: { setProperty: () => {} } },
    getElementsByTagName: () => [styleHost],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, textContent: "" }),
    createTextNode: (text: string) => ({ text }),
    head: styleHost,
  });
});
afterAll(() => vi.unstubAllGlobals());

// Bare paths on both sides, the shape `createTwoFilesPatch(path, path, …)` emits.
// An a/ and b/ prefix without a `diff --git` line makes Pierre read the name as
// `b/src/a.ts` and call the file a rename.
const firstEdit = ["--- src/a.ts", "+++ src/a.ts", "@@ -1 +1,2 @@", " keep", "+one", ""].join("\n");
const secondEdit = ["--- src/a.ts", "+++ src/a.ts", "@@ -2 +2,2 @@", " one", "+two", ""].join("\n");

/** What change-scopes.ts produces when one turn edits the same file twice. */
const repeatedFile = `${firstEdit}\n${secondEdit}`;

test("one patch holding two diffs of the same path parses as two files", () => {
  const files = parsePatchFiles(repeatedFile).flatMap((parsed) => parsed.files);
  expect(files.length).toBe(2);
  expect(files.map((file) => file.name)).toEqual(["src/a.ts", "src/a.ts"]);
  expect(files.map((file) => file.type)).toEqual(["change", "change"]);
});

test("a file edited twice in one turn renders both edits instead of throwing", () => {
  const parsed = parseUnifiedPatch(repeatedFile);
  expect(parsed).toBeDefined();
  const markup = renderToStaticMarkup(
    <DiffView
      path="src/a.ts"
      diff={parsed ?? { patch: "", added: 0, removed: 0 }}
      variant="stack"
    />,
  );
  expect(markup).not.toContain("Something went wrong");
  // Two diff hosts, one per edit, each with its own numbering.
  expect(markup.split("diffs-container").length - 1).toBeGreaterThanOrEqual(2);
});

test("an unparseable patch degrades to its raw text rather than taking the panel down", () => {
  const markup = renderToStaticMarkup(
    <DiffView
      path="src/a.ts"
      diff={{ patch: "this is not a patch", added: 0, removed: 0 }}
      variant="stack"
    />,
  );
  expect(markup).toContain("this is not a patch");
});
