import { afterAll, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_WAITS } from "./transcript-presentation.ts";
import type { RenderedTurn } from "./transcript-rows.ts";
import { TurnView } from "./turn-view.tsx";

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

function render(turn: RenderedTurn): string {
  return renderToStaticMarkup(
    <TurnView
      turn={turn}
      liveTools={new Map()}
      cwd={undefined}
      onOpenChanges={() => {}}
      running={false}
      waits={NO_WAITS}
    />,
  );
}

const continuation: RenderedTurn = {
  kind: "turn",
  id: "completion",
  run: { kind: "none" },
  startedAt: 1,
  durationMs: 0,
  parts: [],
};

test("a completion's continuation turn renders nothing before its response", () => {
  expect(render(continuation)).toBe("");
});

test("a stopped continuation turn reports the stop instead of a blank row", () => {
  expect(
    render({ ...continuation, failure: { class: "aborted", message: "Run interrupted" } }),
  ).toContain("Run stopped.");
});

test("the response attached to a continuation turn renders without a user bubble", () => {
  const html = render({
    ...continuation,
    parts: [
      {
        kind: "assistant",
        commit: "answer",
        contentIndex: 0,
        text: "Build looks green.",
        at: 1,
      },
    ],
  });
  expect(html).toContain("Build looks green.");
  expect(html).not.toContain("data-sticky-user-message");
});
