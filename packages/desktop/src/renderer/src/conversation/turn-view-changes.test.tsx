import { afterAll, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_WAITS } from "./transcript-presentation.ts";
import type { RenderedTurn } from "./transcript-rows.ts";
import { TurnView } from "./turn-view.tsx";
import { WorkGroupView } from "./tool-group.tsx";
import { treeId } from "@nyte-ai/protocol";
import type { RunDiff } from "@nyte-ai/protocol";

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
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
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

function render(turn: RenderedTurn, running: boolean, runDiff?: RunDiff): string {
  return renderToStaticMarkup(
    <TurnView
      turn={turn}
      runDiff={runDiff}
      liveTools={new Map()}
      cwd={undefined}
      onOpenChanges={() => {}}
      running={running}
      waits={NO_WAITS}
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

const editing: RenderedTurn = {
  kind: "turn",
  id: "editing",
  run: { kind: "run", id: "editing-run" },
  startedAt: 1,
  durationMs: 0,
  parts: [
    {
      kind: "tool",
      callId: "edit-1",
      at: 1,
      class: { kind: "file_patch", op: "edit", path: "src/app.ts", added: 1, removed: 1, patch },
      result: { commit: "result-1", output: "ok", isError: false },
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

test("an exact run diff replaces recorded edits with deleted files and totals", () => {
  const runDiff = {
    kind: "tree",
    from: treeId("0".repeat(40)),
    to: treeId("1".repeat(40)),
    files: [
      {
        kind: "deleted",
        path: "src/removed.ts",
        added: 0,
        removed: 1_755,
        patch: "--- a/src/removed.ts\n+++ /dev/null",
      },
    ],
  } satisfies RunDiff;
  const html = render(editing, false, runDiff);
  expect(html).toContain('aria-label="1 File Changed"');
  expect(html).toContain("Open src/removed.ts in Changes");
  expect(html).toContain('aria-label="0 added, 1755 removed"');
  expect(html.indexOf(">1755<")).toBeLessThan(html.indexOf('aria-label="1 File Changed"'));
  expect(html).not.toContain("Open src/app.ts in Changes");
  expect(html).not.toContain('aria-label="1 added, 1 removed"');
});

test("two work groups in one turn use their own episode spans", () => {
  const html = render(
    {
      kind: "turn",
      id: "episodes",
      run: { kind: "run", id: "episodes-run" },
      startedAt: 0,
      durationMs: 15_000,
      parts: [
        { kind: "thinking", commit: "one", contentIndex: 0, text: "First", at: 0 },
        {
          kind: "tool",
          callId: "one",
          class: { kind: "file_read", path: "one.ts" },
          result: { commit: "one-result", output: "done", isError: false },
          at: 2_000,
        },
        { kind: "assistant", commit: "middle", contentIndex: 0, text: "Between", at: 3_000 },
        { kind: "thinking", commit: "two", contentIndex: 0, text: "Second", at: 10_000 },
        {
          kind: "tool",
          callId: "two",
          class: { kind: "file_read", path: "two.ts" },
          result: { commit: "two-result", output: "done", isError: false },
          at: 15_000,
        },
      ],
    },
    false,
    {
      kind: "tree",
      from: treeId("2".repeat(40)),
      to: treeId("3".repeat(40)),
      files: [
        {
          kind: "modified",
          path: "src/episodes.ts",
          added: 7,
          removed: 3,
          patch,
        },
      ],
    },
  );
  expect(html).toContain("for 2s");
  expect(html).toContain("for 5s");
  expect(html).not.toContain("for 15s");
  expect(html.match(/aria-label="7 added, 3 removed"/gu)).toHaveLength(1);
});

test("a run that has not touched a file draws no card", () => {
  expect(render({ ...editing, parts: [] }, true)).not.toContain("Changed");
});

test("a command failure stays on the tool row without failing the work group", () => {
  const html = renderToStaticMarkup(
    <WorkGroupView
      parts={[
        { kind: "thinking", commit: "thought", contentIndex: 0, text: "Checking", at: 0 },
        {
          kind: "tool",
          callId: "test",
          at: 2_200,
          class: { kind: "shell", command: "pnpm test" },
          result: { commit: "test-result", output: "One test failed", isError: true },
        },
      ]}
      run={{ kind: "none" }}
      liveTools={new Map()}
      cwd={undefined}
      added={0}
      removed={0}
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
        {
          kind: "tool",
          callId: "unfinished",
          at: 0,
          class: { kind: "file_read", path: "README.md" },
        },
      ]}
      run={{ kind: "none" }}
      liveTools={new Map()}
      cwd={undefined}
      added={0}
      removed={0}
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
  const html = render(
    { ...editing, failure: { class: "provider", message: "The model went away" } },
    false,
  );
  expect(html).toContain("The model went away");
  expect(html).toContain("Open src/app.ts in Changes");
  expect(html).not.toContain("Work failed");
});
