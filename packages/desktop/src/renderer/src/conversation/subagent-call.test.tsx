/**
 * A backgrounded task and the later wait on it are two calls on one job. The
 * transcript draws the job once: the spawn is the agent card, the await a
 * compact line that links to the same child.
 */
import { afterAll, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { JobInfo } from "@nyte-ai/protocol";
import { SubagentInspectorProvider } from "./subagent-inspector.ts";
import type { RenderedTurn } from "./transcript-rows.ts";
import { TurnView } from "./turn-view.tsx";

vi.mock("../outbox-storage.ts", () => ({
  createIndexedDbOutboxStorage: () => ({
    load: async () => [],
    put: async () => undefined,
    remove: async () => undefined,
  }),
}));

vi.hoisted(() => {
  const query = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => {} } },
    matchMedia: () => query,
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

const parent = sessionId("chat");
const child = sessionId("child");
const job: JobInfo = {
  id: "job-explore",
  kind: "subagent",
  childSessionId: child,
  runId: "run",
  callId: "task",
  head: "main",
  title: "Map the workbench",
  mode: "background",
  state: "completed",
  startedAt: 1,
  updatedAt: 2,
  output: "Three panels found.",
};

const turn: RenderedTurn = {
  kind: "turn",
  id: "turn",
  startedAt: 1,
  durationMs: 0,
  parts: [
    {
      kind: "tool",
      callId: "task",
      class: { kind: "delegate", role: "spawn", title: "Map the workbench", child },
      result: { commit: "spawned", output: "Started job-explore", isError: false },
    },
    {
      kind: "tool",
      callId: "wait",
      class: { kind: "delegate", role: "await", jobId: "job-explore" },
      result: { commit: "waited", output: "Three panels found.", isError: false },
    },
  ],
};

test("a spawn and its await draw one agent card and one compact line", () => {
  const client = new QueryClient();
  client.setQueryData(["jobs", parent], [job]);
  const inspect = vi.fn();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SubagentInspectorProvider value={{ sessionId: parent, inspect }}>
        <TurnView turn={turn} liveTools={new Map()} cwd={undefined} />
      </SubagentInspectorProvider>
    </QueryClientProvider>,
  );
  client.clear();
  // The card is the only place the job's state is spelled out.
  expect(html.match(/>Completed</g)?.length).toBe(1);
  expect(html.match(/>Map the workbench</g)?.length).toBe(2);
  expect(html).toContain(">Waited for<");
  expect(html.match(/aria-label="Open Map the workbench in the Agents panel"/g)?.length).toBe(2);
});
