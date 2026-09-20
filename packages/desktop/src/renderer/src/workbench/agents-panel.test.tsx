import { afterAll, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { RunPhase, SessionId, SessionInfo, SessionSnapshot } from "@nyte-ai/protocol";
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

function agent(id: SessionId, name: string, phase: RunPhase | undefined): SessionInfo {
  return {
    sessionId: id,
    activation: { kind: "active" },
    name,
    createdAt: 1,
    lastActivityAt: 1,
    pinned: false,
    archived: false,
    heads: [
      {
        head: "main",
        tip: null,
        ...(phase === undefined
          ? {}
          : {
              run: {
                runId: "child-run",
                head: "main",
                origin: { kind: "user" },
                root: "child-run",
                phase,
                startedAt: 1,
                attempts: 1,
                config: {},
              },
            }),
      },
    ],
    config: {},
    parent: { sessionId: parent, runId: "run", callId: "call", depth: 1 },
  };
}

const explore = agent(child, "explore", { kind: "tools" });
const childSnapshot: SessionSnapshot = {
  seq: 3,
  session: explore,
  head: "main",
  tip: null,
  config: { model: { provider: "openai", id: "gpt-5" } },
  transcript: [
    {
      kind: "turn",
      id: "turn-1",
      startedAt: 1,
      durationMs: 0,
      parts: [
        { kind: "user", commit: "u", parent: null, content: "Map the workbench" },
        { kind: "assistant", commit: "a", contentIndex: 0, text: "Three panels found." },
      ],
    },
  ],
  pending: [],
  context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1 },
};

function render(
  agents: readonly SessionInfo[] | undefined,
  withChild = true,
  visible = true,
): string {
  const client = new QueryClient();
  if (agents !== undefined) client.setQueryData(["sessions", "children", parent], agents);
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
    const second = { ...agent(sessionId("other"), "other", { kind: "tools" }), lastActivityAt: 5 };
    agentActions.select("test", child);
    try {
      expect(render([explore, second], true, false)).toBe("");
      expect(render([explore, second])).toContain('aria-label="Showing explore, Working"');
      const finished = render([
        agent(child, "explore", { kind: "failed", failure: { class: "runner", message: "x" } }),
        second,
      ]);
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
        <AgentsPanel owner="test" sessionId={undefined} visible />
      </QueryClientProvider>,
    );
    expect(noSession).toContain("Open a chat to follow its subagents.");
    expect(render([])).toContain("has not delegated to a subagent yet");
  });

  test("shows the running agent with its transcript, model, stop, and composer", () => {
    const html = render([explore]);
    expect(html).toContain('aria-label="Showing explore, Working"');
    expect(html).toContain("Three panels found.");
    expect(html).toContain("gpt-5");
    expect(html).toContain('aria-label="Stop agent"');
    expect(html).toContain('aria-label="Message explore"');
  });

  test("a finished or idle agent keeps its transcript and composer but loses stop", () => {
    const done = render([agent(child, "explore", { kind: "done" })]);
    expect(done).toContain('aria-label="Showing explore, Completed"');
    expect(done).toContain("Three panels found.");
    expect(done).not.toContain('aria-label="Stop agent"');
    expect(done).toContain('aria-label="Message explore"');
    expect(render([agent(child, "explore", undefined)])).toContain(
      'aria-label="Showing explore, Idle"',
    );
  });

  test("follows the selected agent and falls back to the most recently active one", () => {
    const second = {
      ...agent(sessionId("other"), "general", { kind: "tools" }),
      lastActivityAt: 5,
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
