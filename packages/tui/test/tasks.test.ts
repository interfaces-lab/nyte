import { afterEach, expect, test } from "vitest";
import { DEFAULT_LANDING, type SessionSnapshot } from "@nyte-ai/core";
import { createTestRenderer } from "@opentui/core/testing";
import { laneRoles } from "../src/lanes.ts";
import { foldEvent, stateFromSnapshot } from "../src/session-state.ts";
import { buildShell } from "../src/shell.ts";
import { TaskBrowser } from "../src/task-browser.ts";
import { canStopTask, projectTasks, TaskIndex, taskLabel, taskStatus } from "../src/tasks.ts";
import { DARK_THEME } from "../src/theme.ts";
import { echo, gate, openHost } from "./helpers.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0).toReversed()) close();
});

async function fixture() {
  const host = await openHost();
  const parent = await host.nyte.sessions.create();
  const snapshot = await host.nyte.sessions.snapshot({ sessionId: parent.sessionId });
  if (snapshot === undefined) throw new Error("Missing session");
  return { host, snapshot };
}

function withShell(snapshot: SessionSnapshot, finished: boolean): SessionSnapshot {
  return {
    ...snapshot,
    transcript: [
      {
        kind: "turn",
        id: "turn",
        startedAt: 1,
        durationMs: 12,
        outcome: "completed",
        parts: [
          {
            kind: "tool",
            callId: "bash-1",
            toolName: "bash",
            args: { command: "pnpm test" },
            ...(finished
              ? { result: { commit: "result", output: "All tests passed", isError: false } }
              : {}),
          },
        ],
      },
    ],
  };
}

test("only running shell calls are tasks", async () => {
  const { snapshot } = await fixture();
  const run = {
    runId: "run",
    head: "main",
    phase: { kind: "tools" as const },
    startedAt: 1,
    attempts: 1,
    config: {},
  };
  expect(projectTasks(stateFromSnapshot({ ...withShell(snapshot, true), run }), [])).toEqual([]);
  const task = projectTasks(stateFromSnapshot({ ...withShell(snapshot, false), run }), [])[0];
  if (task === undefined) throw new Error("Missing shell task");
  expect(taskLabel(task)).toBe("pnpm test");
  expect(taskStatus(task)).toBe("running");
  expect(canStopTask(task)).toBe(true);
});

test("discovers children from durable parent links without a live spawn event", async () => {
  const { host, snapshot } = await fixture();
  const child = await host.nyte.sessions.create({
    name: "Review changes",
    parent: {
      sessionId: snapshot.session.sessionId,
      runId: "parent-run",
      callId: "task-1",
      agent: "reviewer",
      depth: 1,
    },
  });
  const errors: unknown[] = [];
  const index = new TaskIndex({
    nyte: host.nyte,
    onChange: () => {},
    onError: (error) => errors.push(error),
  });
  cleanups.push(() => index.close());
  index.update(stateFromSnapshot(snapshot));
  await expect.poll(() => index.tasks.map(taskLabel)).toEqual(["Review changes"]);
  expect(index.tasks[0]?.id).toBe(child.sessionId);
  expect(errors).toEqual([]);
});

test("inspection preserves the draft and filter through updates, resize, and Escape", async () => {
  const { host, snapshot } = await fixture();
  const setup = await createTestRenderer({
    width: 90,
    height: 28,
    useThread: false,
    kittyKeyboard: true,
    openConsoleOnError: false,
  });
  cleanups.push(() => setup.renderer.destroy());
  const shell = buildShell(setup.renderer, DARK_THEME, laneRoles(DEFAULT_LANDING), () => {});
  const errors: unknown[] = [];
  const browser = new TaskBrowser({
    shell,
    nyte: host.nyte,
    onClose: () => {},
    onError: (error) => errors.push(error),
  });
  cleanups.push(() => browser.dispose());
  const run = {
    runId: "run",
    head: "main",
    phase: { kind: "tools" as const },
    startedAt: 1,
    attempts: 1,
    config: {},
  };
  const folded = foldEvent(stateFromSnapshot({ ...withShell(snapshot, false), run }), {
    seq: 99,
    kind: "tool_progress",
    runId: "run",
    callId: "bash-1",
    progress: { text: "All tests passed" },
  });
  if (folded.kind !== "state") throw new Error("Expected folded state");
  const state = folded.state;
  setup.renderer.start();
  shell.input.setText("keep my draft");
  browser.update(state);
  browser.open();
  setup.mockInput.pressKey("p");
  browser.update(state);
  setup.mockInput.pressEnter();
  await setup.waitForVisualIdle();
  expect(setup.captureCharFrame()).toContain("All tests passed");
  expect(setup.captureCharFrame()).toContain("esc back");
  expect(shell.live.visible).toBe(false);
  setup.resize(70, 22);
  setup.mockInput.pressKey("z");
  expect(shell.input.plainText).toBe("keep my draft");
  setup.mockInput.pressEscape();
  await setup.waitForVisualIdle();
  expect(shell.live.visible).toBe(true);
  expect(shell.selecting).toBe(true);
  setup.mockInput.pressEscape(); // clear the preserved filter
  expect(shell.selecting).toBe(true);
  setup.mockInput.pressEscape(); // return to composer
  expect(shell.selecting).toBe(false);
  setup.mockInput.pressKey("x");
  expect(shell.input.plainText).toContain("x");
  expect(shell.hints.parent).toBe(shell.live);
  expect(errors).toEqual([]);
});

test("child tasks stream status and stop through the core run API", async () => {
  const held = gate();
  const host = await openHost(echo({ gate: held }));
  cleanups.push(() => held.release());
  const parent = await host.nyte.sessions.create();
  const child = await host.nyte.sessions.create({
    name: "Inspect source",
    parent: {
      sessionId: parent.sessionId,
      runId: "parent-run",
      callId: "task-live",
      agent: "explore",
      depth: 1,
    },
  });
  const snapshot = await host.nyte.sessions.snapshot({ sessionId: parent.sessionId });
  if (snapshot === undefined) throw new Error("Missing parent");
  const errors: Error[] = [];
  const index = new TaskIndex({
    nyte: host.nyte,
    onChange: () => {},
    onError: (error) => errors.push(error),
  });
  cleanups.push(() => index.close());
  index.update(stateFromSnapshot(snapshot));
  host.nyte.attach();
  await host.nyte.messages.send({ sessionId: child.sessionId, content: "Inspect source" });
  await expect.poll(() => index.tasks.map(taskStatus)).toEqual(["running"]);
  expect(index.tasks.some(canStopTask)).toBe(true);
  await host.nyte.runs.abort({ sessionId: child.sessionId });
  await expect.poll(() => index.tasks.map(taskStatus)).toEqual(["stopped"]);
  expect(index.tasks.some(canStopTask)).toBe(false);
  expect(errors).toEqual([]);
});
