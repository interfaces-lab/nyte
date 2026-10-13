/**
 * Rows come from `status.schedule`: a steer core moved to the next turn
 * reads "next turn · new model", not "steer"; reports never appear; action
 * messages show their label and are not editable; unsent rows are not
 * withdrawable through a receipt.
 */
import { asId } from "@nyte-ai/schema";
import { describe, expect, test } from "bun:test";
import { placeLabel, queuedCount, queueRows, reportRows } from "../../src/model/queue.ts";
import type { ScheduleSpec } from "../fixture/view.ts";
import { followed, viewOf } from "../fixture/view.ts";

function label(schedule: ScheduleSpec, covered = true): string | null {
  const view = viewOf((v) =>
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
    const view = viewOf((v) =>
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
    const view = viewOf((v) =>
      v.unsent("a").unsent("b", { retrying: { at: 9_000, reason: "offline" } }),
    );

    const rows = queueRows(followed(view), null);

    expect(rows.map((row) => placeLabel(row.place))).toEqual(["sending…", "retrying · offline"]);
    expect(rows.map((row) => row.withdrawable)).toEqual([false, false]);
  });
});

describe("rows", () => {
  test("reports wait apart and are never the user's rows", () => {
    const view = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("go").ended("completed"))
        .pending("mine", { schedule: { kind: "next-turn", reason: "idle" } })
        .report({ child: "s9" }, "Child s9 completed:\nall done"),
    );

    const session = followed(view);

    expect(queueRows(session, null).map((row) => row.text)).toEqual(["mine"]);
    expect(reportRows(session, [])).toMatchObject([
      { title: "subagent completed", body: "all done", tone: "ok" },
    ]);
  });

  test("an action shows its label and is not editable", () => {
    const view = viewOf((v) =>
      v.pending(
        "a long prebuilt prompt",
        { schedule: { kind: "next-turn", reason: "idle" } },
        { source: { kind: "action", label: "Fix lint" } },
      ),
    );

    const [row] = queueRows(followed(view), null);

    expect(row).toMatchObject({ text: "Fix lint", editable: false, withdrawable: true });
  });

  test("rows keep inbox order and mark the one being edited", () => {
    const view = viewOf((v) =>
      v
        .pending("one", { schedule: { kind: "next-turn", reason: "run-ended" } }, { id: "m1" })
        .pending("two", { schedule: { kind: "joined", run: "run-1" } }, { id: "m2" }),
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
    const view = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .live()
        .pending("a", { schedule: { kind: "joined", run: "run-t1" } })
        .pending("b", { schedule: { kind: "next-turn", reason: "run-ended" } })
        .unsent("c"),
    );

    expect(queuedCount(queueRows(followed(view), null))).toBe(1);
  });

  test("a file block in a queued message shows as its marker", () => {
    const view = viewOf((v) =>
      v.pending('look <file src="file:///w/a.ts">\nbody\n</file>', {
        schedule: { kind: "next-turn", reason: "idle" },
      }),
    );

    expect(queueRows(followed(view), null)[0]?.text).toBe("look [File a.ts]");
  });
});
