import { afterAll, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Turn } from "@nyte-ai/core";
import { TurnView } from "./turn-view.tsx";

vi.hoisted(() => {
  const query = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => {} } },
    matchMedia: () => query,
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
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

function render(turn: Turn, running: boolean): string {
  return renderToStaticMarkup(
    <TurnView
      turn={turn}
      liveTools={new Map()}
      cwd={undefined}
      onOpenChanges={() => {}}
      running={running}
    />,
  );
}

const patch = [
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  " same",
].join("\n");

const editing: Turn = {
  kind: "turn",
  id: "editing",
  startedAt: 1,
  durationMs: 0,
  outcome: "completed",
  parts: [
    {
      kind: "tool",
      callId: "edit-1",
      toolName: "edit",
      args: { path: "src/app.ts" },
      result: { commit: "result-1", output: "ok", isError: false, details: { patch } },
    },
  ],
};

test("a live run reserves the changes card frame with its count but no file list", () => {
  const html = render(editing, true);
  expect(html).toContain('aria-label="1 File Changed"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain(">Review<");
  expect(html).not.toContain("Open src/app.ts in Changes");
});

test("a settled run fills the same frame with its files", () => {
  const html = render(editing, false);
  expect(html).toContain('aria-label="1 File Changed"');
  expect(html).toContain("Open src/app.ts in Changes");
});

test("a run that has not touched a file draws no card", () => {
  expect(render({ ...editing, parts: [] }, true)).not.toContain("Changed");
});
