/**
 * A turn draws its blocks in view order with the status row last; a report
 * is never the user's message; an action shows its label, never its prompt.
 */
import { describe, expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { App } from "../../../src/app/context.tsx";
import { SPINNER_FRAMES } from "../../../src/lib/constants.ts";
import { Transcript } from "../../../src/ui/transcript/transcript.tsx";
import { stateOf } from "../../fixture/state.ts";
import { followed, viewOf } from "../../fixture/view.ts";
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
  test("a report is drawn as a report row, never as the user's message", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) =>
        t.report({ child: "s9" }, "Child s9 completed:\nAll done here").ended("completed"),
      ),
    );

    await using app = await renderWithApp(stateOf(followed(view)), transcript);
    const frame = app.captureCharFrame();

    expect(app.renderer.root.findDescendantById("report:m1")).toBeDefined();
    expect(app.renderer.root.findDescendantById("user:m1")).toBeUndefined();
    expect(frame).toContain("↳ subagent completed");
    expect(frame).toContain("All done here");
  });

  test("an action shows its label and never its prompt", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) => t.action("Fix lint", "Please run the linter and fix").ended("completed")),
    );

    await using app = await renderWithApp(stateOf(followed(view)), transcript);
    const frame = app.captureCharFrame();

    expect(frame).toContain("Fix lint");
    expect(frame).not.toContain("run the linter");
  });

  test("blocks follow view order and the status row is always last", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) =>
        t
          .user("question")
          .text("first answer")
          .user("a steer that landed mid-turn")
          .tool("search", { output: "found it" })
          .text("second answer")
          .ended("completed"),
      ),
    );

    await using app = await renderWithApp(stateOf(followed(view)), transcript);
    const turn = app.renderer.root.findDescendantById("turn:t1");

    expect(turn?.getChildren().map((block) => block.id)).toEqual([
      "user:m1",
      "text:m2",
      "user:m3",
      "tool:call-4",
      "text:m4",
      "status:t1",
    ]);
  });

  test("a live turn keeps the spinner row under its content, and it spins", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) => t.user("question").text("streaming", { live: true })).live(),
    );

    await using app = await renderWithApp(stateOf(followed(view)), transcript);
    const turn = app.renderer.root.findDescendantById("turn:t1");

    expect(turn?.getChildren().map((block) => block.id)).toEqual([
      "user:m1",
      "text:m2",
      "status:t1",
    ]);
    expect(app.captureCharFrame()).toContain(`${SPINNER_FRAMES[0]} Working`);
    app.clock.advance();
    await app.renderOnce();
    expect(app.captureCharFrame()).toContain(`${SPINNER_FRAMES[1]} Working`);
  });

  test("a retrying run shows its countdown, attempt and cause", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) => t.user("question")).retrying("rate limited", 9_000),
    );

    await using app = await renderWithApp(stateOf(followed(view)), transcript);

    expect(app.captureCharFrame()).toContain("Retrying in 9s (attempt 0) · rate limited.");
    expect(app.clock.active()).toBeGreaterThan(0);
  });

  test("a report row click opens the task", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) =>
        t.report({ job: "job-1" }, "Job lint finished.\nclean").ended("completed"),
      ),
    );

    const state = stateOf(followed(view));

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
