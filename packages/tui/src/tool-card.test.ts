import { afterEach, expect, test } from "bun:test";
import { MAIN, sessionId } from "@nyte-ai/core";
import type { SessionState } from "@nyte-ai/client";
import type { ToolState, TurnToolClass } from "@nyte-ai/protocol";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import { mountShell } from "./app/App.tsx";
import { deliveryChoices } from "./lanes.ts";
import { DARK_THEME } from "./theme.ts";

type TranscriptTurn = Extract<
  SessionState["transcript"]["items"][number],
  { readonly kind: "turn" }
>;

type ToolPart = Extract<TranscriptTurn["parts"][number], { readonly kind: "tool" }>;

const mounted: TestRendererSetup[] = [];

afterEach(() => {
  for (const setup of mounted.splice(0)) setup.renderer.destroy();
});

const settled = { commit: "result" } as const;

let calls = 0;

function call(toolClass: TurnToolClass, state: ToolState, output?: string): ToolPart {
  calls += 1;

  return { kind: "tool", callId: `call-${String(calls)}`, class: toolClass, state, output, at: 0 };
}

function session(parts: readonly ToolPart[], running: boolean): SessionState {
  const activeSession = sessionId("tool-card");

  const turn: TranscriptTurn = {
    kind: "turn",
    id: "turn",
    run: { kind: "run", id: "run" },
    parts: [{ kind: "user", commit: "user", parent: null, content: "go", at: 0 }, ...parts],
    startedAt: 0,
    durationMs: 500,
  };

  return {
    sessionId: activeSession,
    head: MAIN,
    seq: 1,
    info: {
      sessionId: activeSession,
      activation: { kind: "active" },
      workspace: { kind: "local", id: "test", cwd: "/" },
      createdAt: 0,
      lastActivityAt: 0,
      pinned: false,
      archived: false,
      heads: [{ head: MAIN, tip: "turn" }],
      config: {},
    },
    config: {},
    transcript: { items: [turn], tip: "turn" },
    pending: [],
    run: running
      ? {
          runId: "run",
          head: MAIN,
          origin: { kind: "user" },
          root: "run",
          phase: { kind: "tools" },
          startedAt: 0,
          attempts: 1,
          config: {},
        }
      : undefined,
    compaction: undefined,
    overlay: [],
    settledToolCalls: new Set(),
    parked: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 128_000 },
    expectedTip: undefined,
  };
}

async function render(parts: readonly ToolPart[], running = false): Promise<string[]> {
  const setup = await createTestRenderer({ width: 90, height: 30 });
  mounted.push(setup);

  const shell = await mountShell({
    renderer: setup.renderer,
    initialTheme: DARK_THEME,
    roles: deliveryChoices,
    openPath: () => undefined,
  });

  shell.view.sync(session(parts, running));
  await setup.flush();
  await setup.waitForVisualIdle();

  return setup.captureCharFrame().split("\n");
}

const line = (frame: readonly string[], text: string) =>
  frame
    .find((row) => row.includes(text))
    ?.replace(/\s+/gu, " ")
    .trim();

test("a settled shell call names its exit code and core's measured duration, never a client clock", async () => {
  const frame = await render([
    call(
      { kind: "shell", command: "pnpm test", facts: { durationMs: 1234, truncated: false } },
      { kind: "error", reason: { kind: "exit", code: 1 }, ...settled },
      "FAIL a\nFAIL b\nFAIL c",
    ),
  ]);

  expect(line(frame, "pnpm test")).toBe("✗ ran pnpm test 3 lines · exit 1 · 1.2s");
});

test("a call that did not finish asserts no verb: the subject, the tool's noun, the cause", async () => {
  const frame = await render([
    call(
      { kind: "file_edit", path: "src/a.ts" },
      { kind: "error", reason: { kind: "denied" }, ...settled },
    ),
    call(
      { kind: "file_read", path: "src/b.ts" },
      { kind: "error", reason: { kind: "interrupted" }, commit: null },
    ),
    call(
      { kind: "shell", command: "sleep 99" },
      { kind: "error", reason: { kind: "timeout" }, ...settled },
    ),
  ]);

  expect(line(frame, "src/a.ts")).toBe("✗ src/a.ts edit blocked");
  expect(line(frame, "src/b.ts")).toBe("✗ src/b.ts read interrupted");
  expect(line(frame, "sleep 99")).toBe("✗ sleep 99 timed out");
});

test("success and a running call add no word", async () => {
  const frame = await render(
    [
      call({ kind: "list", path: "src" }, { kind: "success", ...settled }, "a\nb"),
      call({ kind: "shell", command: "pnpm build" }, { kind: "running" }),
    ],
    true,
  );

  expect(line(frame, "listed src")).toBe("✓ listed src 2 lines");
  expect(line(frame, "pnpm build")).toContain("running pnpm build");
  expect(line(frame, "pnpm build")).not.toMatch(/failed|stopped|exit/u);
});

test("a call on a child keeps its own outcome, whatever the child is doing", async () => {
  const target = { kind: "one", session: sessionId("child") } as const;
  const denied: ToolState = { kind: "error", reason: { kind: "denied" }, ...settled };

  const frame = await render([
    call({ kind: "delegate", role: "create", title: "review agent", target }, denied),
    call({ kind: "delegate", role: "send", target }, denied),
    call({ kind: "delegate", role: "read", target }, denied),
    call({ kind: "delegate", role: "stop", target }, { kind: "success", ...settled }),
  ]);

  expect(line(frame, "review agent")).toBe("✗ review agent blocked");
  expect(line(frame, "subagent message")).toBe("✗ subagent message blocked");
  expect(line(frame, "subagent transcript")).toBe("✗ subagent transcript blocked");
  expect(line(frame, "stopped subagent")).toBe("✓ stopped subagent");
});
