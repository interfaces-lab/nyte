import { expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { Task } from "../../../src/lib/tasks.ts";
import type { InspectorDialog } from "../../../src/model/dialogs/tasks.ts";
import { InspectorView } from "../../../src/ui/dialogs/inspector.tsx";
import { frameShowing } from "../../fixture/render.tsx";
import { buildState } from "../../fixture/state.ts";
import { followed, buildView } from "../../fixture/view.ts";
import { DialogHost } from "../../../src/ui/dialogs/dialog-host.tsx";
import { renderWithApp } from "../transcript/harness.tsx";
import { renderDialog } from "./harness.tsx";

const DIALOG: InspectorDialog = {
  kind: "inspector",
  id: "i1",
  task: "job-1",
  following: true,
  scroll: null,
};

const JOB: Task = {
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
    tail: "first output line\nsecond output line",
    foreground: false,
  },
};

test("the host draws a loading inspector inline until the task is known", async () => {
  await using app = await renderDialog(DIALOG);
  const frame = app.frame();

  expect(frame).toContain("Tasks");
  expect(frame).toContain("job-1 · Loading…");
  expect(frame).toContain("esc back");
  expect(frame).not.toContain("ctrl+x cancel");
});

test("cancel is offered only while the task can still be stopped", async () => {
  const done: Task = {
    ...JOB,
    job: { ...JOB.job, state: { kind: "exited", code: 0, reason: "exited" }, endedAt: 5 },
  };

  for (const [task, offered] of [
    [JOB, true],
    [done, false],
  ] as const) {
    await using app = await renderDialog(DIALOG, {
      width: 120,
      node: () => <InspectorView dialog={DIALOG} task={task} />,
    });

    expect(app.frame().includes("ctrl+x cancel")).toBe(offered);
  }
});

test("a job's inspector shows its status and output tail at widths 40 and 100", async () => {
  for (const width of [40, 100]) {
    await using app = await renderDialog(DIALOG, {
      width,
      node: () => <InspectorView dialog={DIALOG} task={JOB} />,
    });

    const frame = app.frame();

    expect(frame).toContain("pnpm test");
    expect(frame).toContain("running");
    expect(frame).toContain("first output line");
    expect(frame).toContain("second output line");
  }
});

test("a job with no output yet says so", async () => {
  await using app = await renderDialog(DIALOG, {
    node: () => <InspectorView dialog={DIALOG} task={{ ...JOB, job: { ...JOB.job, tail: "" } }} />,
  });

  expect(app.frame()).toContain("No output yet.");
});

test("the host resolves the task from the screen, with its elapsed time", async () => {
  const base = buildState(null);
  const job: Task = { ...JOB, job: { ...JOB.job, startedAt: -65_000 } };

  await using app = await renderDialog(DIALOG, {
    state: { ...base, facts: { ...base.facts, tasks: [job] } },
  });

  const frame = app.frame();

  expect(frame).not.toContain("Loading…");
  expect(frame).toContain("running · 1m 5s");
  expect(frame).toContain("first output line");
});

test("an agent's inspector draws the child's transcript", async () => {
  const base = buildState(null);

  const child = followed(
    buildView((v) => v.turn("t1", (t) => t.user("child task").text("child reply"))),
    "c1",
  );

  const agent: Task = {
    kind: "agent",
    id: child.id,
    info: child.info,
    view: child.view ?? undefined,
  };

  await using app = await renderWithApp(
    {
      ...base,
      facts: { ...base.facts, tasks: [agent] },
      local: { ...base.local, dialogs: [{ ...DIALOG, task: "c1" }] },
    },
    () => <DialogHost />,
  );

  expect(await frameShowing(app, "child reply")).toContain("child reply");
});
