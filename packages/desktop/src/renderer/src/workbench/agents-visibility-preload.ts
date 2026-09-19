// Standalone browser-test preload. Import before any renderer module reads window.nyte.
import { sessionId } from "@nyte-ai/protocol";
import type { SessionInfo, SessionSnapshot } from "@nyte-ai/protocol";
import type { NyteBridge } from "../../../shared/ipc.ts";

export const visibilityParent = sessionId("visibility-parent");
export const visibilityChild = sessionId("visibility-child");
const visibilityOther = sessionId("visibility-other");

const runningAgent: SessionInfo = {
  sessionId: visibilityChild,
  activation: { kind: "active" },
  name: "Selected agent",
  createdAt: Date.now(),
  lastActivityAt: Date.now(),
  pinned: false,
  archived: false,
  heads: [
    {
      head: "main",
      tip: null,
      run: {
        runId: "visibility-run",
        head: "main",
        phase: { kind: "tools" },
        startedAt: Date.now(),
        attempts: 1,
        config: {},
      },
    },
  ],
  config: {},
  parent: { sessionId: visibilityParent, runId: "parent-run", callId: "visibility-call", depth: 1 },
};

const agents: SessionInfo[] = [
  runningAgent,
  {
    ...runningAgent,
    sessionId: visibilityOther,
    name: "Newest agent",
    lastActivityAt: runningAgent.lastActivityAt + 1,
  },
];

export const agentVisibilityScript = {
  activeClocks: new Set<number>(),
  snapshots: 0,
  listReads: 0,
  watches: 0,
  unwatches: 0,
  aborts: 0,
  activeWatches: 0,
  failSnapshot: false,
  agents,
  snapshot: {
    seq: 3,
    session: runningAgent,
    head: "main",
    tip: null,
    config: {},
    transcript: Array.from({ length: 40 }, (_, index) => ({
      kind: "turn" as const,
      id: `turn-${String(index)}`,
      startedAt: 1,
      durationMs: 1,
      outcome: "completed" as const,
      parts: [
        {
          kind: "user" as const,
          commit: `u-${String(index)}`,
          parent: null,
          content: `Question ${String(index)}`,
        },
        {
          kind: "assistant" as const,
          commit: `a-${String(index)}`,
          contentIndex: 0,
          text: `Answer ${String(index)}`,
        },
      ],
    })),
    pending: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1 },
  } satisfies SessionSnapshot,
  cursors: new Array<Parameters<NyteBridge["watch"]>[0]>(),
};

const snapshot: NyteBridge["sessions"]["snapshot"] = async () => {
  agentVisibilityScript.snapshots += 1;
  if (agentVisibilityScript.failSnapshot) throw new Error("Scripted snapshot failure");
  return agentVisibilityScript.snapshot;
};
const metadata: NyteBridge["sessions"]["metadata"] = async () => {
  const { session, head, config, context } = agentVisibilityScript.snapshot;
  return { session, head, config, context };
};
const list: NyteBridge["sessions"]["list"] = async () => {
  agentVisibilityScript.listReads += 1;
  return { items: agentVisibilityScript.agents };
};
const abort: NyteBridge["runs"]["abort"] = async () => {
  agentVisibilityScript.aborts += 1;
  return { kind: "not_running" };
};
const watch: NyteBridge["watch"] = (input) => {
  agentVisibilityScript.watches += 1;
  agentVisibilityScript.activeWatches += 1;
  agentVisibilityScript.cursors.push(input);
  return () => {
    agentVisibilityScript.unwatches += 1;
    agentVisibilityScript.activeWatches -= 1;
  };
};

Object.defineProperty(window, "nyte", {
  configurable: true,
  value: {
    sessions: { snapshot, metadata, list },
    runs: { abort },
    watch,
    host: {
      state: () => new Promise(() => {}),
      catalog: () => new Promise(() => {}),
      setThemePreference: () => {},
    },
    plugins: { catalog: () => new Promise(() => {}) },
  },
});

const setInterval = window.setInterval.bind(window);
const clearInterval = window.clearInterval.bind(window);
Object.defineProperty(window, "setInterval", {
  configurable: true,
  value: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const timer = setInterval(handler, timeout, ...args);
    if (timeout === 1_000) agentVisibilityScript.activeClocks.add(timer);
    return timer;
  },
});
Object.defineProperty(window, "clearInterval", {
  configurable: true,
  value: (timer: number | undefined) => {
    if (timer !== undefined) agentVisibilityScript.activeClocks.delete(timer);
    clearInterval(timer);
  },
});
