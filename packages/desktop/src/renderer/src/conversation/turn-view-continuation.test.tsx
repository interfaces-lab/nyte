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

function render(turn: Turn): string {
  return renderToStaticMarkup(
    <TurnView turn={turn} liveTools={new Map()} cwd={undefined} onOpenChanges={() => {}} />,
  );
}

const continuation: Turn = {
  kind: "turn",
  id: "completion",
  startedAt: 1,
  durationMs: 0,
  outcome: "completed",
  parts: [],
};

test("a completion's continuation turn renders nothing before its response", () => {
  expect(render(continuation)).toBe("");
});

test("a stopped continuation turn reports the stop instead of a blank row", () => {
  expect(render({ ...continuation, outcome: "aborted" })).toContain("Run stopped.");
});

test("the response attached to a continuation turn renders without a user bubble", () => {
  const html = render({
    ...continuation,
    parts: [{ kind: "assistant", commit: "answer", contentIndex: 0, text: "Build looks green." }],
  });
  expect(html).toContain("Build looks green.");
  expect(html).not.toContain("data-sticky-user-message");
});
