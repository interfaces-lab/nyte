import { asId } from "@nyte-ai/schema";
import { describe, expect, test } from "bun:test";
import { placeLabel, queuedCount, queueRows } from "../../src/model/queue.ts";
import type { ScheduleSpec } from "../fixture/view.ts";
import { followed, buildView } from "../fixture/view.ts";

function label(schedule: ScheduleSpec, covered = true): string | null {
  const view = buildView((v) =>
    v
      .turn("t1", (t) => t.user("go"))
      .live()
      .pending("x", { schedule, covered }),
  );

  const [row] = queueRows(followed(view), null);

  return row === undefined ? null : placeLabel(row.place);
}

describe("labels follow the schedule, never the delivery", () => {
  test("a steer scheduled for the next turn is labelled by its schedule", () => {
    const view = buildView((v) =>
      v
        .live("r1")
        .pending("use tabs", { schedule: { kind: "next-turn", reason: "configuration" } }),
    );

    const [row] = queueRows(followed(view), null);

    expect(row === undefined ? null : placeLabel(row.place)).toBe("next turn · new model");
  });

  test.each([
    [{ kind: "joined", run: "run-t1" }, "steer · next response"],
    [{ kind: "next-turn", reason: "requested" }, "queued"],
    [{ kind: "next-turn", reason: "idle" }, "next"],
    [{ kind: "next-turn", reason: "run-ended" }, "after this run"],
    [{ kind: "next-turn", reason: "configuration" }, "next turn · new model"],
    [{ kind: "attached" }, "attached"],
  ] satisfies [ScheduleSpec, string][])("%o reads %s", (schedule, expected) => {
    expect(label(schedule)).toBe(expected);
  });

  test("a pending message no host covers waits for a host", () => {
    expect(label({ kind: "joined", run: "run-t1" }, false)).toBe("waiting for a host");
  });

  test("an unsent message is sending, or retrying with its reason", () => {
    const view = buildView((v) =>
      v
        .unsent("a")
        .unsent("b", { retrying: { at: 9_000, reason: "offline" } })
        .live("run-1"),
    );

    const rows = queueRows(followed(view), null);

    expect(rows.map((row) => placeLabel(row.place))).toEqual(["sending…", "retrying · offline"]);
    expect(rows.map((row) => row.withdrawable)).toEqual([false, false]);
  });
});

describe("rows", () => {
  test("reports are never the user's rows", () => {
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.user("go").ended("completed"))
        .pending("mine", { schedule: { kind: "next-turn", reason: "idle" } })
        .report({ child: "s9" }, "all done")
        .live("run-2"),
    );

    expect(queueRows(followed(view), null).map((row) => row.text)).toEqual(["mine"]);
  });

  test("an action shows its label and is not editable", () => {
    const view = buildView((v) =>
      v
        .pending(
          "a long prebuilt prompt",
          { schedule: { kind: "next-turn", reason: "idle" } },
          { source: { kind: "action", label: "Fix lint" } },
        )
        .live("run-1"),
    );

    const [row] = queueRows(followed(view), null);

    expect(row).toMatchObject({ text: "Fix lint", editable: false, withdrawable: true });
  });

  test("rows keep inbox order and mark the one being edited", () => {
    const view = buildView((v) =>
      v
        .pending("one", { schedule: { kind: "next-turn", reason: "run-ended" } }, { id: "m1" })
        .pending("two", { schedule: { kind: "joined", run: "run-1" } }, { id: "m2" })
        .live("run-1"),
    );

    const rows = queueRows(followed(view), {
      message: asId("m2"),
      delivery: "steer",
      saved: { text: "", parts: new Map() },
    });

    expect(rows.map((row) => [String(row.id), row.editing])).toEqual([
      ["m1", false],
      ["m2", true],
    ]);
  });

  test("the footer counts rows waiting for a later run, not the ones joining this run", () => {
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .live()
        .pending("a", { schedule: { kind: "joined", run: "run-t1" } })
        .pending("b", { schedule: { kind: "next-turn", reason: "run-ended" } })
        .unsent("c"),
    );

    expect(queuedCount(queueRows(followed(view), null))).toBe(1);
  });

  test("a file mention in a queued message shows as its marker", () => {
    const view = buildView((v) =>
      v
        .pending("look @file:///w/a.ts", {
          schedule: { kind: "next-turn", reason: "idle" },
        })
        .live("run-1"),
    );

    expect(queueRows(followed(view), null)[0]?.text).toBe("look [File a.ts]");
  });
});
