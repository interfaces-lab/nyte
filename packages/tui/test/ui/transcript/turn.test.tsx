import { describe, expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { App } from "../../../src/app/context.tsx";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../../../src/lib/constants.ts";
import { Transcript } from "../../../src/ui/transcript/transcript.tsx";
import { buildState } from "../../fixture/state.ts";
import { followed, buildView } from "../../fixture/view.ts";
import { renderWithApp } from "./harness.tsx";
import type { Task } from "../../../src/lib/tasks.ts";

const TASKS: readonly Task[] = [
  {
    kind: "job",
    id: asId("job-1"),
    job: {
      id: asId("job-1"),
      title: "lint",
      command: "pnpm lint",
      session: null,
      pty: null,
      startedAt: 0,
      endedAt: 1,
      state: { kind: "exited", reason: "exited", code: 0 },
      tail: "",
      foreground: false,
    },
  },
];

function transcript(app: App) {
  return (
    <Transcript
      model={() => app.screen().transcript}
      tasks={() => TASKS}
      attach={() => () => undefined}
      onScrolled={() => undefined}
      onRevealEarlier={() => undefined}
      onLatest={() => undefined}
    />
  );
}

describe("turn", () => {
  test("a turn the window cut after its prompt shows the prompt, then that earlier steps are not shown", async () => {
    const whole = buildView((v) =>
      v.turn("t1", (t) => t.user("Fix the build").text("first").text("latest").ended("completed")),
    );

    const [prompt, , ...rest] = whole.messages;

    if (prompt?.kind !== "user") throw new Error("The fixture's turn starts with its prompt");

    await using app = await renderWithApp(
      buildState(followed({ ...whole, messages: rest, leadingPrompt: prompt })),
      transcript,
    );

    const turn = app.renderer.root.findDescendantById("turn:t1");

    expect(turn?.getChildren().map((block) => block.id)).toEqual([
      "user:m1",
      "earlier:t1",
      "text:m3",
      "status:t1",
    ]);
    expect(app.captureCharFrame()).toContain("earlier steps not shown");
  });

  test("an action shows its label and never its prompt", async () => {
    const view = buildView((v) =>
      v.turn("t1", (t) => t.action("Fix lint", "Please run the linter and fix").ended("completed")),
    );

    await using app = await renderWithApp(buildState(followed(view)), transcript);
    const frame = app.captureCharFrame();

    expect(frame).toContain("Fix lint");
    expect(frame).not.toContain("run the linter");
  });

  test("a canvas shows its title and where to open it", async () => {
    const view = buildView((v) =>
      v.turn("t1", (t) =>
        t
          .user("chart it")
          .part(
            "canvas",
            { runtime: 1, title: "Weekly signups", code: "", height: null, error: null },
            { role: "answer" },
          )
          .ended("completed"),
      ),
    );

    await using app = await renderWithApp(buildState(followed(view)), transcript);
    const frame = app.captureCharFrame();

    expect(frame).toContain("Weekly signups");
    expect(frame).toContain("open this chat in Nyte desktop");
    expect(frame).not.toContain("[canvas]");
  });

  test("a part it has no renderer for shows its kind and state raw", async () => {
    const view = buildView((v) =>
      v.turn("t1", (t) =>
        t
          .user("map it")
          .part("maps/places", { pins: [{ name: "Cafe" }] }, { role: "answer" })
          .ended("completed"),
      ),
    );

    await using app = await renderWithApp(buildState(followed(view)), transcript);
    const frame = app.captureCharFrame();

    expect(frame).toContain('[maps/places] { "pins": [ { "name": "Cafe" } ] }');
  });

  test("blocks keep view order and changing output mode expands the card", async () => {
    const view = buildView((v) =>
      v.turn("t1", (t) =>
        t
          .user("question")
          .text("first answer")
          .user("a steer that landed mid-turn")
          .tool("search", {
            output: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8",
          })
          .text("second answer")
          .ended("completed"),
      ),
    );

    const state = buildState(followed(view));
    await using app = await renderWithApp(state, transcript);
    const turn = app.renderer.root.findDescendantById("turn:t1");

    expect(turn?.getChildren().map((block) => block.id)).toEqual([
      "user:m1",
      "text:m2",
      "user:m3",
      "tool:call-4",
      "text:m4",
      "status:t1",
    ]);
    expect(app.captureCharFrame()).toContain("… 2 more lines · ctrl+o expand");
    expect(app.captureCharFrame()).not.toContain("line 5");

    app.setState({
      ...state,
      local: { ...state.local, transcript: { ...state.local.transcript, toolOutput: "expanded" } },
    });
    await app.renderOnce();

    expect(app.captureCharFrame()).not.toContain("more lines");
    expect(app.captureCharFrame()).toContain("line 5");
  });

  test("a live turn keeps the spinner row under its content, and it spins", async () => {
    const view = buildView((v) =>
      v.turn("t1", (t) => t.user("question").text("streaming", { live: true })).live(),
    );

    await using app = await renderWithApp(buildState(followed(view)), transcript);
    const turn = app.renderer.root.findDescendantById("turn:t1");

    expect(turn?.getChildren().map((block) => block.id)).toEqual([
      "user:m1",
      "text:m2",
      "status:t1",
    ]);
    expect(app.captureCharFrame()).toContain(`${SPINNER_FRAMES[0]} Working`);
    app.clock.advance(SPINNER_INTERVAL_MS);
    await app.renderOnce();
    expect(app.captureCharFrame()).toContain(`${SPINNER_FRAMES[1]} Working`);
  });

  test("a retrying run shows its countdown, attempt and cause", async () => {
    const view = buildView((v) =>
      v.turn("t1", (t) => t.user("question")).retrying("rate limited", 9_000),
    );

    await using app = await renderWithApp(buildState(followed(view)), transcript);

    expect(app.captureCharFrame()).toContain("Retrying in 9s (attempt 0) · rate limited.");
    expect(app.clock.pendingTimerCount).toBeGreaterThan(0);
  });

  test("a report row click opens the task", async () => {
    const view = buildView((v) =>
      v.turn("t1", (t) =>
        t.report({ job: "job-1" }, "Job lint finished.\nclean").ended("completed"),
      ),
    );

    const state = buildState(followed(view));

    await using app = await renderWithApp(
      {
        ...state,
        facts: {
          ...state.facts,
          tasks: TASKS,
        },
      },
      transcript,
    );

    const row = app
      .captureCharFrame()
      .split("\n")
      .findIndex((line) => line.includes("↳ Job lint"));

    expect(row).toBeGreaterThanOrEqual(0);
    await app.mockMouse.click(3, row);

    expect(app.dispatched).toEqual([
      { kind: "open", dialog: { kind: "inspector", task: "job-1" } },
    ]);
  });
});
