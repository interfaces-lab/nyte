import { afterAll, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { JobInfo, SessionSnapshot } from "@nyte-ai/core";
import { AgentsPanel } from "./agents-panel.tsx";
import { agentActions } from "./agents-store.ts";

vi.hoisted(() => {
  const query = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => {} } },
    matchMedia: () => query,
  });
  vi.stubGlobal("indexedDB", { open: () => ({ addEventListener: () => {} }) });
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
const explore: JobInfo = {
  id: "job-explore",
  kind: "subagent",
  childSessionId: child,
  runId: "run",
  callId: "call",
  head: "main",
  title: "explore",
  mode: "foreground",
  state: "running",
  startedAt: 1,
  updatedAt: 1,
  output: "",
};
const command: JobInfo = {
  ...explore,
  id: "job-command",
  kind: "command",
  title: "pnpm test",
  mode: "background",
};
const childSnapshot: SessionSnapshot = {
  seq: 3,
  session: {
    sessionId: child,
    activation: { kind: "active" },
    createdAt: 1,
    lastActivityAt: 2,
    pinned: false,
    archived: false,
    heads: [],
    config: {},
    parent: { sessionId: parent, runId: "run", callId: "call", depth: 1 },
  },
  head: "main",
  tip: null,
  config: { model: { provider: "openai", id: "gpt-5" } },
  transcript: [
    {
      kind: "turn",
      id: "turn-1",
      startedAt: 1,
      durationMs: 0,
      outcome: "completed",
      parts: [
        { kind: "user", commit: "u", parent: null, content: "Map the workbench" },
        { kind: "assistant", commit: "a", contentIndex: 0, text: "Three panels found." },
      ],
    },
  ],
  pending: [],
  context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1 },
};

function render(jobs: readonly JobInfo[] | undefined, withChild = true, visible = true): string {
  const client = new QueryClient();
  if (jobs !== undefined) client.setQueryData(["jobs", parent], jobs);
  if (withChild) client.setQueryData(["snapshot", child], childSnapshot);
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AgentsPanel owner="test" sessionId={parent} visible={visible} />
      </QueryClientProvider>,
    );
  } finally {
    client.clear();
  }
}

describe("agents panel", () => {
  test("hidden panels render no agent content and retain the selected child on reopen", () => {
    const second: JobInfo = {
      ...explore,
      id: "job-other",
      childSessionId: sessionId("other"),
      title: "other",
      updatedAt: 5,
    };
    agentActions.select("test", child);
    try {
      expect(render([explore, second], true, false)).toBe("");
      expect(render([explore, second])).toContain('aria-label="Showing explore, Working"');
      const finished = render([{ ...explore, state: "failed", output: "Agent failed" }, second]);
      expect(finished).toContain('aria-label="Showing explore, Failed"');
      expect(finished).toContain("Three panels found.");
      expect(finished).not.toContain('aria-label="Stop agent"');
    } finally {
      agentActions.clear("test");
    }
  });

  test("explains itself without a chat or without delegations", () => {
    const client = new QueryClient();
    const noSession = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AgentsPanel owner="test" sessionId={undefined} />
      </QueryClientProvider>,
    );
    expect(noSession).toContain("Open a chat to follow its subagents.");
    expect(render([command])).toContain("has not delegated to a subagent yet");
  });

  test("shows the running agent with its transcript, model, and controls", () => {
    const html = render([explore, command]);
    expect(html).toContain('aria-label="Showing explore, Working"');
    expect(html).toContain("Map the workbench");
    expect(html).toContain("Three panels found.");
    expect(html).toContain("gpt-5");
    expect(html).toContain('aria-label="Stop agent"');
    expect(html).toContain('aria-label="Run in background"');
    expect(html).not.toContain("pnpm test");
  });

  test("a finished agent keeps its transcript but loses its controls", () => {
    const html = render([{ ...explore, state: "completed", updatedAt: 9_001 }]);
    expect(html).toContain('aria-label="Showing explore, Completed"');
    expect(html).toContain("Completed after 9s");
    expect(html).not.toContain('aria-label="Stop agent"');
    expect(html).not.toContain('aria-label="Run in background"');
  });

  test("follows the selected agent and falls back to the newest one", () => {
    const second: JobInfo = {
      ...explore,
      id: "job-general",
      childSessionId: sessionId("other"),
      title: "general",
      updatedAt: 5,
    };
    expect(render([explore, second], true)).toContain('aria-label="Showing general, Working"');
    agentActions.select("test", child);
    try {
      expect(render([explore, second])).toContain('aria-label="Showing explore, Working"');
    } finally {
      agentActions.clear("test");
    }
  });
});
