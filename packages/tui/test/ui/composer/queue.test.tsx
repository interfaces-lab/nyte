import { asId } from "@nyte-ai/schema";
import { describe, expect, test } from "bun:test";
import type { Msg } from "../../../src/model/msg.ts";
import { reduce } from "../../../src/model/reduce.ts";
import { QueueRows } from "../../../src/ui/composer/queue.tsx";
import { buildView } from "../../fixture/view.ts";
import { NOW, ready } from "../../model/support.ts";
import { mount } from "../chrome/support.tsx";

const SIZE = { width: 100, height: 40 } as const;

function findRow(frame: string, text: string): string {
  return frame.split("\n").find((line) => line.includes(text)) ?? "";
}

function lineIndex(frame: string, text: string): number {
  return frame.split("\n").findIndex((line) => line.includes(text));
}

const everySchedule = buildView((v) =>
  v
    .turn("t1", (t) => t.user("hi").tool("bash", { running: true }), { run: "r1" })
    .pending("asked for later", { schedule: { kind: "next-turn", reason: "requested" } })
    .pending(
      "when idle",
      { schedule: { kind: "next-turn", reason: "idle" } },
      { delivery: "queue" },
    )
    .pending("after the run", { schedule: { kind: "next-turn", reason: "run-ended" } })
    .pending("on the new model", { schedule: { kind: "next-turn", reason: "configuration" } })
    .pending("ride along", { schedule: { kind: "attached" } })
    .pending("nobody runs this", {
      schedule: { kind: "next-turn", reason: "requested" },
      covered: false,
    })
    .unsent("on its way", { delivery: "queue" })
    .unsent("trying again", { retrying: { at: 5_000, reason: "offline" } })
    .report({ child: "s9" }, "all done")
    .live(),
);

const three = buildView((v) =>
  v
    .turn("t1", (t) => t.user("hi").text("ok").ended("completed"))
    .pending("first", { schedule: { kind: "next-turn", reason: "requested" } }, { id: "q1" })
    .pending("second", { schedule: { kind: "next-turn", reason: "requested" } }, { id: "q2" })
    .pending("third", { schedule: { kind: "next-turn", reason: "requested" } }, { id: "q3" })
    .report({ child: "s9" }, "all done")
    .live("r2"),
);

describe("labels", () => {
  test("each row reads where core scheduled it, not how it was sent", async () => {
    await using app = await mount(ready(everySchedule), () => <QueueRows />, SIZE);
    const frame = app.captureCharFrame();

    expect(findRow(frame, "asked for later")).toContain("queued");
    expect(findRow(frame, "when idle")).toContain("next");
    expect(findRow(frame, "after the run")).toContain("after this run");
    expect(findRow(frame, "on the new model")).toContain("next turn · new model");
    expect(findRow(frame, "ride along")).toContain("attached");
    expect(findRow(frame, "nobody runs this")).toContain("waiting for a host");
    expect(findRow(frame, "on its way")).toContain("sending…");
    expect(findRow(frame, "trying again")).toContain("retrying · offline");
    expect(findRow(frame, "trying again")).toContain("ctrl+q pending");
    expect(frame).not.toContain("all done");
  });

  test("a narrow row sheds its hint, then its label, to keep twelve columns of text", async () => {
    const one = buildView((v) =>
      v
        .turn("t1", (t) => t.user("hi").text("ok").ended("completed"))
        .pending("a message worth reading", {
          schedule: { kind: "next-turn", reason: "requested" },
        })
        .live("r2"),
    );

    await using wide = await mount(ready(one), () => <QueueRows />, { width: 60, height: 20 });

    expect(findRow(wide.captureCharFrame(), "a message")).toContain("queued · ctrl+q pending");

    await using medium = await mount(ready(one), () => <QueueRows />, { width: 32, height: 20 });
    const row = findRow(medium.captureCharFrame(), "a mess");

    expect(row).toContain("queued");
    expect(row).not.toContain("ctrl+q");

    await using narrow = await mount(ready(one), () => <QueueRows />, { width: 22, height: 20 });

    const stub = findRow(narrow.captureCharFrame(), "a mess");

    expect(stub).toContain("↓ a mess");
    expect(stub).not.toContain("queued");
  });
});

describe("input", () => {
  test("clicking a queue row opens the queue menu for it", async () => {
    await using app = await mount(ready(three), () => <QueueRows />, SIZE);
    await app.mockMouse.click(10, lineIndex(app.captureCharFrame(), "second"));

    expect(app.dispatched).toEqual([
      {
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "queue", message: asId("q2") } },
      },
    ]);
  });

  test("dragging a row onto another dispatches a reorder that revises its inbox position", async () => {
    const state = ready(three);

    const dragged = async (from: string, onto: string): Promise<readonly Msg[]> => {
      await using app = await mount(state, () => <QueueRows />, SIZE);
      const frame = app.captureCharFrame();
      await app.mockMouse.drag(10, lineIndex(frame, from), 10, lineIndex(frame, onto));

      return app.dispatched;
    };

    const position = (msgs: readonly Msg[]) =>
      msgs.flatMap((msg) =>
        reduce(state, msg, NOW).effects.flatMap((effect) =>
          effect.kind === "revise" ? [{ message: effect.message, position: effect.position }] : [],
        ),
      );

    const up = await dragged("third", "first");

    expect(up).toEqual([{ kind: "reorder", message: asId("q3"), to: { before: asId("q1") } }]);
    expect(position(up)).toEqual([
      { message: asId("q3"), position: { kind: "before", message: asId("q1") } },
    ]);

    const down = await dragged("first", "second");

    expect(position(down)).toEqual([
      { message: asId("q1"), position: { kind: "before", message: asId("q3") } },
    ]);

    const last = await dragged("second", "third");

    expect(position(last)).toEqual([{ message: asId("q2"), position: { kind: "last" } }]);

    const lastFromTop = await dragged("first", "third");

    expect(lastFromTop).toEqual([{ kind: "reorder", message: asId("q1"), to: { before: null } }]);
    expect(position(lastFromTop)).toEqual([{ message: asId("q1"), position: { kind: "last" } }]);
  });

  test("dropping a row on itself does nothing", async () => {
    await using app = await mount(ready(three), () => <QueueRows />, SIZE);
    const row = lineIndex(app.captureCharFrame(), "second");
    await app.mockMouse.drag(5, row, 30, row);

    expect(app.dispatched).toEqual([]);
  });
});
