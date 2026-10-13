import { isPart, tool } from "@nyte-ai/plugin/client";
import { openQuestions } from "@nyte-ai/plugin/question";
import { expect, test } from "bun:test";
import { pendingReports, queuedMessages, turnEntries } from "../../src/lib/view-helpers.ts";
import { viewOf } from "../fixture/view.ts";

test("viewOf builds a view the TUI's helpers and the question rule read", () => {
  const view = viewOf((v) =>
    v
      .turn("t1", (t) => t.user("hi").text("hello").ended("completed"))
      .turn("t2", (t) => t.user("go").tool("bash", { running: true }))
      .pending("steer this", { schedule: { kind: "joined", run: "run-t2" } }, { id: "p1" })
      .unsent("sending")
      .report({ child: "s9" }, "done")
      .question("Pick one", ["A", "B"])
      .live(),
  );

  expect(
    turnEntries(view).map((entry): [string, number] => [entry.turn.id, entry.messages.length]),
  ).toEqual([
    ["t1", 2],
    ["t2", 2],
    ["pending:p1", 0],
    ["pending:m5", 0],
  ]);
  expect(
    queuedMessages(view).map((message): [string, string] => [message.id, message.status.kind]),
  ).toEqual([
    ["p1", "pending"],
    ["m4", "unsent"],
  ]);
  expect(pendingReports(view).map((message) => message.source)).toMatchObject([
    { kind: "child", session: "s9" },
  ]);
  expect(openQuestions(view)).toMatchObject([
    { part: "q1", prompt: "Pick one", options: ["A", "B"] },
  ]);
  expect(view.execution).toMatchObject({ kind: "live", run: { id: "run-t2" } });
  const call = view.messages.find((message) => isPart(message, tool));
  expect(call !== undefined && isPart(call, tool) ? call.state.phase : null).toBe("running");
});
