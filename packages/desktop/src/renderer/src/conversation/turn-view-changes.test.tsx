import { afterAll, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Turn } from "@nyte-ai/core";
import type { RenderedTurn } from "./transcript-rows.ts";
import { TurnView } from "./turn-view.tsx";
import { WorkGroupView } from "./tool-group.tsx";

// Read-only transcript rendering does not use the browser's message outbox.
vi.mock("../outbox-storage.ts", () => ({
  createIndexedDbOutboxStorage: () => ({
    load: async () => [],
    put: async () => undefined,
    remove: async () => undefined,
  }),
}));

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

function render(turn: RenderedTurn, running: boolean): string {
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

test("an active turn has no premature review card", () => {
  const html = render(editing, true);
  expect(html).not.toContain('aria-label="1 File Changed"');
  expect(html).not.toContain(">Review<");
  expect(html).not.toContain("Open src/app.ts in Changes");
});

test("a settled turn offers its changed files for review", () => {
  const html = render(editing, false);
  expect(html).toContain('aria-label="1 File Changed"');
  expect(html).toContain("Open src/app.ts in Changes");
});

test("a run that has not touched a file draws no card", () => {
  expect(render({ ...editing, parts: [] }, true)).not.toContain("Changed");
});

test("a command failure stays on the tool row without failing the work group", () => {
  const html = renderToStaticMarkup(
    <WorkGroupView
      parts={[
        {
          kind: "tool",
          callId: "test",
          toolName: "bash",
          args: { command: "pnpm test" },
          result: { commit: "test-result", output: "One test failed", isError: true },
        },
      ]}
      liveTools={new Map()}
      cwd={undefined}
      durationMs={2200}
      running={false}
      density="detailed"
    />,
  );
  expect(html).toContain("Worked");
  expect(html).toContain("for 2s");
  expect(html).toContain("Command failed");
  expect(html).toContain("One test failed");
  expect(html).not.toContain("Work failed");
  expect(html).not.toContain('aria-busy="true"');
});

test("reopening an interrupted tool group does not restart its indicator", () => {
  const html = renderToStaticMarkup(
    <WorkGroupView
      parts={[
        { kind: "tool", callId: "unfinished", toolName: "read", args: { path: "README.md" } },
      ]}
      liveTools={new Map()}
      cwd={undefined}
      durationMs={2200}
      running={false}
      density="detailed"
    />,
  );
  expect(html).toContain("Worked");
  expect(html).toContain("Read stopped");
  expect(html).not.toContain('aria-busy="true"');
  expect(html).not.toContain('data-tool-status="running"');
});

test("a failed run still reports the failure and retains successful edits for review", () => {
  const html = render({ ...editing, outcome: "failed" }, false);
  expect(html).toContain("Run failed.");
  expect(html).toContain("Open src/app.ts in Changes");
  expect(html).not.toContain("Work failed");
});
