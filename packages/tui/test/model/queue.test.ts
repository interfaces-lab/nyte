import { asId } from "@nyte-ai/schema";
import { describe, expect, test } from "bun:test";
import { promptMessages } from "../../src/lib/view-helpers.ts";
import { placeLabel, queuedCount, queueRows } from "../../src/model/queue.ts";
import type { ScheduleSpec, ViewBuilder } from "../fixture/view.ts";
import { followed, buildView } from "../fixture/view.ts";

function pending(schedule: ScheduleSpec, covered = true) {
  return (v: ViewBuilder) =>
    v
      .turn("t1", (t) => t.user("go"))
      .live()
      .pending("x", { schedule, covered }, { delivery: "queue" });
}

const LABELS: readonly (readonly [string, (v: ViewBuilder) => ViewBuilder, string, boolean])[] = [
  [
    "a steer scheduled for the next turn is labelled by its schedule",
    (v) =>
      v.live("r1").pending("use tabs", { schedule: { kind: "next-turn", reason: "run-ended" } }),
    "after this run",
    true,
  ],
  [
    "a message asked for later reads queued",
    pending({ kind: "next-turn", reason: "requested" }),
    "queued",
    true,
  ],
  [
    "a message for when idle reads next",
    pending({ kind: "next-turn", reason: "idle" }),
    "next",
    true,
  ],
  [
    "a message for after the run reads after this run",
    pending({ kind: "next-turn", reason: "run-ended" }),
    "after this run",
    true,
  ],
  ["an attached message reads attached", pending({ kind: "attached" }), "attached", true],
  [
    "a pending message no host covers waits for a host",
    pending({ kind: "next-turn", reason: "requested" }, false),
    "waiting for a host",
    true,
  ],
  [
    "an unsent message is sending",
    (v) => v.unsent("a", { delivery: "queue" }).live("run-1"),
    "sending…",
    false,
  ],
  [
    "an unsent message retrying shows its reason",
    (v) => v.unsent("b", { retrying: { at: 9_000, reason: "offline" } }).live("run-1"),
    "retrying · offline",
    false,
  ],
];

describe("labels follow the schedule, never the delivery", () => {
  test.each(LABELS)("%s", (_name, build, label, withdrawable) => {
    const rows = queueRows(followed(buildView(build)), null);

    expect(rows.map((row) => [placeLabel(row.place), row.withdrawable])).toEqual([
      [label, withdrawable],
    ]);
  });
});

describe("rows", () => {
  test("reports are never the user's rows", () => {
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.user("go").ended("completed"))
        .pending("mine", { schedule: { kind: "next-turn", reason: "idle" } }, { delivery: "queue" })
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
          { delivery: "queue", source: { kind: "action", label: "Fix lint" } },
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
        .pending("two", { schedule: { kind: "next-turn", reason: "requested" } }, { id: "m2" })
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

  test("a steer on its way to this run or joining it is no queue row", () => {
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .live()
        .pending("a", { schedule: { kind: "joined", run: "run-t1" } })
        .pending("b", { schedule: { kind: "next-turn", reason: "run-ended" } })
        .unsent("c")
        .pending("d", { schedule: { kind: "next-turn", reason: "idle" } }),
    );

    const rows = queueRows(followed(view), null);

    expect(rows.map((row) => row.text)).toEqual(["b"]);
    expect(queuedCount(rows)).toBe(1);
    expect(promptMessages(view).map((message) => message.content)).toEqual(["a", "c", "d"]);
  });

  test("a file mention in a queued message shows as its marker", () => {
    const view = buildView((v) =>
      v
        .pending(
          "look @file:///w/a.ts",
          { schedule: { kind: "next-turn", reason: "idle" } },
          { delivery: "queue" },
        )
        .live("run-1"),
    );

    expect(queueRows(followed(view), null)[0]?.text).toBe("look [File a.ts]");
  });
});
