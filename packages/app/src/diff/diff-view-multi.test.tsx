import "../../test/web-bridge.ts";
import { afterAll, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "./diff-view.tsx";

vi.hoisted(() => {
  const query = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", {
    matchMedia: () => query,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "Worker",
    class {
      postMessage(): void {}
      addEventListener(): void {}
      terminate(): void {}
    },
  );
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const styleHost = { insertBefore: () => {}, appendChild: () => {}, firstChild: null };
  vi.stubGlobal("document", {
    documentElement: {
      classList: { toggle: () => {} },
      dataset: {},
      style: { setProperty: () => {} },
    },
    getElementsByTagName: () => [styleHost],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, textContent: "" }),
    createTextNode: (text: string) => ({ text }),
    head: styleHost,
  });
});

afterAll(() => vi.unstubAllGlobals());

const firstEdit = ["--- src/a.ts", "+++ src/a.ts", "@@ -1 +1,2 @@", " keep", "+one", ""].join("\n");

const secondEdit = ["--- src/a.ts", "+++ src/a.ts", "@@ -2 +2,2 @@", " one", "+two", ""].join("\n");

const repeatedFile = `${firstEdit}\n${secondEdit}`;

test("a file edited twice in one turn renders both edits instead of throwing", () => {
  const markup = renderToStaticMarkup(
    <DiffView
      path="src/a.ts"
      diff={{ patch: repeatedFile, added: 2, removed: 0 }}
      variant="stack"
    />,
  );

  expect(markup.match(/<diffs-container/g) ?? []).toHaveLength(2);
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
