import { asId } from "@nyte-ai/schema";
import type { SessionInfo, SessionView } from "@nyte-ai/sdk";
import { describe, expect, test } from "bun:test";
import type { Task } from "../../src/lib/tasks.ts";
import { blockedBy, deriveScreen } from "../../src/model/screen.ts";
import type { State } from "../../src/model/state.ts";
import { followed, viewOf } from "../fixture/view.ts";
import { blank, play, ready, S1, typed } from "./support.ts";

const idle = viewOf((v) => v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")));

const working = viewOf((v) =>
  v.turn("t1", (t) => t.user("hi").tool("bash", { running: true })).live(),
);

function hints(state: State): string {
  return deriveScreen(state, null)
    .hints.map((hint) => `${hint.keycap} ${hint.label}`)
    .join(" · ");
}

function child(view: SessionView, id = "c1"): Task {
  const info: SessionInfo = { ...followed(view, id).info, parent: S1 };

  return { kind: "agent", id: asId(id), info, view };
}

describe("blocked", () => {
  test("one ordered rule: starting, switching, no session, directory, authentication, editor", () => {
    expect(blockedBy(blank())).toEqual({ kind: "starting" });
    expect(blockedBy(play(blank(), { kind: "phase", phase: { kind: "ready" } }).state)).toEqual({
      kind: "no-session",
    });

    const state = ready(idle);

    expect(blockedBy(state)).toBeNull();
    expect(
      blockedBy(play(state, { kind: "switch-session", session: "new", announce: false }).state),
    ).toEqual({
      kind: "switching",
    });
    expect(blockedBy(play(state, { kind: "change-directory", path: "/x" }).state)).toEqual({
      kind: "changing-directory",
    });
    expect(blockedBy(play(state, { kind: "open-editor" }).state)).toEqual({ kind: "editor" });
    expect(
      blockedBy(
        play(state, { kind: "open", dialog: { kind: "auth", mode: "login", provider: "test" } })
          .state,
      ),
    ).toEqual({ kind: "authenticating", link: null });
  });

  test("startup opens quietly until the first view arrives", () => {
    expect(deriveScreen(blank(), null)).toMatchObject({ loading: null, opening: true });

    const session = followed(idle);

    const opened = play(
      blank(),
      { kind: "phase", phase: { kind: "ready" } },
      { kind: "session-opened", session: S1, info: session.info, selection: session.selection },
    ).state;

    expect(deriveScreen(opened, null)).toMatchObject({ loading: null, opening: true });
    expect(deriveScreen(ready(idle), null)).toMatchObject({ loading: null, opening: false });
    expect(
      deriveScreen(
        play(ready(idle), { kind: "switch-session", session: "new", announce: false }).state,
        null,
      ),
    ).toMatchObject({ loading: "Loading session…", opening: false });
  });
});

describe("placeholder", () => {
  test("busy follows the follow-up setting", () => {
    expect(deriveScreen(ready(working), null).placeholder).toBe("Steer the run");

    const queue = play(ready(working), {
      kind: "settings",
      settings: { ...blank().facts.settings, followUp: "queue" },
    }).state;

    expect(deriveScreen(queue, null).placeholder).toBe("Queue a follow-up");
  });

  test("a child's question names its owner once its panel is put away", () => {
    const asking = viewOf((v) =>
      v
        .turn("c", (t) => t.user("go"))
        .question(
          [
            {
              question: "Which file?",
              header: "Question",
              options: [
                { label: "a", description: "" },
                { label: "b", description: "" },
              ],
            },
          ],
          { id: "q9" },
        )
        .waiting("q9"),
    );

    const state = play(ready(idle), { kind: "tasks", session: S1, tasks: [child(asking)] }).state;

    expect(deriveScreen(state, null).dialog).toMatchObject({ title: "Subagent c1: Which file?" });
    expect(deriveScreen(state, null).placeholder).toBe("");

    const later = play(state, { kind: "dialog", command: { kind: "close" } }).state;

    expect(deriveScreen(later, null).placeholder).toBe(
      "Answer subagent c1, or press Enter to pick one",
    );
    expect(deriveScreen(later, null).tasksLine).toEqual({
      text: "a background task needs your answer",
      attention: true,
    });
  });

  test("the head's question comes before a child's", () => {
    const asking = viewOf((v) =>
      v
        .turn("c", (t) => t.user("go"))
        .question(
          [{ question: "Child?", header: "Question", options: [{ label: "a", description: "" }] }],
          { id: "q9" },
        ),
    );

    const own = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("hi"))
        .question(
          [{ question: "Mine?", header: "Question", options: [{ label: "x", description: "" }] }],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const state = play(ready(own), { kind: "tasks", session: S1, tasks: [child(asking)] }).state;

    expect(deriveScreen(state, null).question).toMatchObject({
      part: "q1",
      owner: { kind: "head" },
    });
  });
});

describe("hints", () => {
  test("idle at 100 columns: primary hints, then the secondaries that fit", () => {
    expect(hints(ready(idle))).toBe(
      "enter send · esc tree (twice) · ctrl+c quit · ctrl+k help · shift+tab thinking · ctrl+p model",
    );
  });

  test("a narrow terminal keeps only the primary hints (Ctrl+C is secondary while Esc shows)", () => {
    const narrow = play(ready(idle), {
      kind: "terminal",
      terminal: { width: 40, height: 20, theme: "dark", selection: false, dragging: false },
    }).state;

    expect(hints(narrow)).toBe("enter send · esc tree (twice) · ctrl+k help");
  });

  test("a `!` draft runs locally; a running command is stopped with Esc", () => {
    expect(hints(play(ready(idle), typed("!ls")).state)).toContain("enter run locally");

    const running = play(ready(idle), {
      kind: "shell-job",
      job: {
        id: "j",
        session: S1,
        command: "sleep 9",
        include: true,
        startedAt: 1,
        output: "",
        state: { kind: "running" },
        delivered: false,
      },
    }).state;

    expect(hints(running)).toContain("esc stop command");
    expect(hints(running)).not.toContain("ctrl+c stop command");
  });

  test("while busy the alternate delivery is offered when there is a message", () => {
    expect(hints(play(ready(working), typed("more")).state)).toContain("ctrl+enter queue");
  });

  test("a dialog takes the hint row away from the chat", () => {
    const open = play(ready(idle), {
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "settings", highlight: null } },
    }).state;

    expect(hints(open)).toBe("");
  });

  test("the hint row freezes while the mouse drags a selection", () => {
    const state = ready(idle);
    const before = deriveScreen(state, null);

    const dragging = play(state, typed("x"), {
      kind: "terminal",
      terminal: { width: 100, height: 32, theme: "dark", selection: true, dragging: true },
    }).state;

    expect(deriveScreen(dragging, before).hints).toBe(before.hints);
  });
});

describe("footer and status", () => {
  test("the footer shows the configurator's selection and counts later-run rows only while busy", () => {
    const view = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .live()
        .pending("b", { schedule: { kind: "next-turn", reason: "run-ended" } }),
    );

    const screen = deriveScreen(ready(view), null);

    expect(screen.footer.powerline).toMatchObject({
      model: "model",
      effort: "medium",
      queued: 1,
      workspace: "w",
    });
  });

  test("OSC 7501: a question blocks, a run works, a watched run that completed is done until a key", () => {
    const asking = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("hi"))
        .question(
          [{ question: "Pick", header: "Question", options: [{ label: "A", description: "" }] }],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    expect(deriveScreen(ready(asking), null).program).toEqual({
      state: "blocked",
      kind: "question",
      msg: "Pick",
    });
    expect(deriveScreen(ready(working), null).program).toEqual({ state: "working" });

    const done = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("hi").tool("bash").ended("completed"))
        .idle({ run: "run-t1", end: "completed" }),
    );

    const finished = play(ready(working), { kind: "view", session: S1, view: done }).state;

    expect(deriveScreen(finished, null).program).toEqual({ state: "done" });
    expect(deriveScreen(play(finished, { kind: "dismiss-notice" }).state, null).program).toEqual({
      state: "idle",
    });
  });

  test("the tasks line counts unfinished tasks", () => {
    const busyChild = viewOf((v) => v.turn("c", (t) => t.user("go")).live("run-c"));

    expect(
      deriveScreen(
        play(ready(idle), { kind: "tasks", session: S1, tasks: [child(busyChild)] }).state,
        null,
      ).tasksLine,
    ).toEqual({
      text: "1 running in background",
      attention: false,
    });
    expect(deriveScreen(ready(idle), null).tasksLine).toBeNull();
  });
});

describe("identity", () => {
  test("unchanged queue rows and hints keep their identity across frames", () => {
    const view = viewOf((v) => v.pending("a", { schedule: { kind: "next-turn", reason: "idle" } }));
    const state = ready(view);
    const first = deriveScreen(state, null);
    const second = deriveScreen(play(state, { kind: "tick", now: 5 }).state, first);

    expect(second.queue).toBe(first.queue);
    expect(second.hints).toBe(first.hints);
    expect(second.transcript.rows).toBe(first.transcript.rows);
  });
});

describe("drawing inputs", () => {
  test("the session's tasks and the wheel setting reach the screen as they are", () => {
    const job: Task = {
      kind: "job",
      id: "job-1",
      job: {
        id: asId("job-1"),
        command: "pnpm test",
        title: "pnpm test",
        session: null,
        pty: null,
        state: { kind: "running" },
        startedAt: 0,
        endedAt: null,
        tail: "",
      },
    };

    const state = play(ready(idle), { kind: "tasks", session: S1, tasks: [job] }).state;
    const accelerated: State = {
      ...state,
      facts: { ...state.facts, settings: { ...state.facts.settings, scrollAcceleration: true } },
    };

    expect(deriveScreen(state, null)).toMatchObject({ tasks: [job], scrollAcceleration: false });
    expect(deriveScreen(accelerated, null).scrollAcceleration).toBe(true);
  });
});
