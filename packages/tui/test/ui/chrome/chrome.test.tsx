import { asId } from "@nyte-ai/schema";
import { describe, expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { DARK_THEME, themeForMode } from "../../../src/lib/theme.ts";
import { ErrorScreen } from "../../../src/ui/chrome/error-screen.tsx";
import { Footer } from "../../../src/ui/chrome/footer.tsx";
import { Hints } from "../../../src/ui/chrome/hints.tsx";
import { NoticeLine } from "../../../src/ui/chrome/notice.tsx";
import { TasksLine } from "../../../src/ui/chrome/tasks-line.tsx";
import type { State } from "../../../src/model/state.ts";
import { viewOf } from "../../fixture/view.ts";
import { play, ready, S1, typed } from "../../model/support.ts";
import { mount } from "./support.tsx";

const idle = viewOf((v) => v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")));

const working = viewOf((v) =>
  v.turn("t1", (t) => t.user("hi").tool("bash", { running: true })).live(),
);

function sized(state: State, width: number): State {
  return play(state, {
    kind: "terminal",
    terminal: { ...state.facts.terminal, width },
  }).state;
}

describe("footer", () => {
  test("drops usage, then workspace, then effort as the terminal narrows; the model stays", async () => {
    for (const [width, shown, dropped] of [
      [100, ["w", "model", "medium", "1.0k/100.0k · 1% context"], []],
      [30, ["w │ model │ medium"], ["context"]],
      [20, ["model"], ["medium", "context", " w "]],
    ] as const) {
      await using app = await mount(sized(ready(idle), width), () => <Footer focused />, {
        width,
        height: 4,
      });

      const frame = app.captureCharFrame().split("\n")[0] ?? "";

      for (const text of shown) expect(frame).toContain(text);

      for (const text of dropped) expect(frame).not.toContain(text);
      expect(frame.trimEnd().endsWith("╯")).toBe(true);
    }
  });
});

describe("hints", () => {
  test("a wide terminal shows secondary hints; a narrow one keeps only the primaries", async () => {
    const draft = play(ready(working), typed("fix it")).state;

    await using wide = await mount(sized(draft, 160), () => <Hints />, { width: 160, height: 2 });
    const wideRow = wide.captureCharFrame();

    expect(wideRow).toContain("enter steer");
    expect(wideRow).toContain("esc stop");
    expect(wideRow).toContain("ctrl+enter queue");
    expect(wideRow).toContain("shift+tab");

    await using narrow = await mount(sized(draft, 40), () => <Hints />, { width: 40, height: 2 });
    const narrowRow = narrow.captureCharFrame();

    expect(narrowRow).toContain("enter steer");
    expect(narrowRow).not.toContain("ctrl+enter");
    expect(narrowRow).not.toContain("shift+tab");
  });
});

describe("notice line", () => {
  test("shows the notice, a failure with its log path, and a retry for a failed watch", async () => {
    const state = play(
      ready(idle),
      { kind: "refuse", reason: "Already sent", tone: "warning" },
      {
        kind: "failure",
        failure: { origin: "effect", message: "boom", logPath: "/home/.nyte/logs/tui.log" },
      },
      { kind: "watch-ended", session: S1, failure: "socket closed" },
    ).state;

    await using app = await mount(state, () => <NoticeLine />, { width: 100, height: 4 });
    const frame = app.captureCharFrame();

    expect(frame).toContain("Session updates stopped · socket closed · retry");
    expect(frame).toContain("Something failed in effect: boom · /home/.nyte/logs/tui.log");
    expect(frame).toContain("Already sent");

    const row = frame.split("\n").findIndex((line) => line.includes("retry"));
    const column = frame.split("\n")[row]?.indexOf("retry") ?? -1;
    await app.mockMouse.click(column + 1, row);

    expect(app.dispatched).toContainEqual({ kind: "retry-watch" });
  });

  test("a two-line notice shows both lines, a confirmation in the ok colour", async () => {
    const state = play(ready(idle), {
      kind: "inform",
      tone: "ok",
      text: "Signed in to Test.\nModel: test/model",
    }).state;

    await using app = await mount(state, () => <NoticeLine />, { width: 60, height: 4 });
    const lines = app.captureCharFrame().split("\n");
    const first = lines.findIndex((line) => line.includes("Signed in to Test."));

    expect(lines[first + 1]).toContain("Model: test/model");

    const span = app
      .captureSpans()
      .lines[first]?.spans.find((candidate) => candidate.text.includes("Signed in"));

    expect(span?.fg.toString()).toBe(RGBA.fromHex(DARK_THEME.ok).toString());
  });
});

describe("tasks line", () => {
  test("clicking it opens the task list", async () => {
    const state = play(ready(idle), {
      kind: "tasks",
      session: S1,
      tasks: [
        {
          kind: "job",
          id: "j1",
          job: {
            id: asId("j1"),
            title: "build",
            command: "make",
            session: S1,
            pty: null,
            state: { kind: "running" },
            tail: "",
            startedAt: 1,
            endedAt: null,
          },
        },
      ],
    }).state;

    await using app = await mount(state, () => <TasksLine />, { width: 60, height: 2 });

    expect(app.captureCharFrame()).toContain("● 1 running in background · ↓ view");
    await app.mockMouse.click(5, 0);
    expect(app.dispatched).toContainEqual({
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } },
    });
  });
});

describe("error screen", () => {
  test("shows the error and the log path; R resets and Q quits", async () => {
    const reset = mock(() => undefined);
    const quit = mock(() => undefined);

    await using app = await testRender(
      () => (
        <ErrorScreen
          theme={DARK_THEME}
          error={new Error("render exploded")}
          logPath="/home/.nyte/logs/tui.log"
          reset={reset}
          quit={quit}
        />
      ),
      { width: 80, height: 20, kittyKeyboard: true },
    );

    await app.renderOnce();
    const frame = app.captureCharFrame();

    expect(frame).toContain("render exploded");
    expect(frame).toContain("/home/.nyte/logs/tui.log");
    expect(frame).toContain("r reset · q quit");

    app.mockInput.pressKey("r");
    expect(reset).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();

    app.mockInput.pressKey("q");
    expect(quit).toHaveBeenCalledTimes(1);
  });

  test("draws in the app theme, so NO_COLOR leaves it gray", async () => {
    const plain = themeForMode("dark", { NO_COLOR: "1" });

    await using app = await testRender(
      () => (
        <ErrorScreen
          theme={plain}
          error={new Error("render exploded")}
          logPath="/home/.nyte/logs/tui.log"
          reset={() => undefined}
          quit={() => undefined}
        />
      ),
      { width: 80, height: 20 },
    );

    await app.renderOnce();
    const line = app
      .captureSpans()
      .lines.find((candidate) =>
        candidate.spans.some((span) => span.text.includes("Something went wrong")),
      );

    const span = line?.spans.find((candidate) => candidate.text.includes("Something went wrong"));

    expect(span?.fg.toString()).toBe(RGBA.fromHex(plain.error).toString());
    expect(plain.error).toMatch(/^#(..)\1\1$/u);
  });
});
