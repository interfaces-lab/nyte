import { expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { HeadInfo, SessionInfo, SessionView } from "@nyte-ai/sdk";
import { taskLabel } from "@nyte-ai/plugin/client/presentation";
import { taskStatus, unfinishedTask } from "../../src/lib/tasks.ts";
import type { Task } from "../../src/lib/tasks.ts";
import { buildView } from "../fixture/view.ts";

const ID = asId<"session">("child-1");

function head(view: SessionView, background: HeadInfo["background"]): HeadInfo {
  return {
    name: asId("main"),
    tip: { kind: "start" },
    stack: null,
    execution: view.execution,
    unread: false,
    background,
  };
}

function child(view: SessionView, background: HeadInfo["background"]): Task {
  const info: SessionInfo = {
    id: ID,
    name: "explorer",
    parent: asId("s1"),
    call: null,
    workspace: asId("w"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [head(view, background)],
    createdAt: 0,
    lastActivityAt: 0,
  };

  return { kind: "agent", id: ID, info, view: { ...view, heads: [head(view, background)] } };
}

const ended = buildView((v) => v.turn("c1", (t) => t.user("look around").text("Found it.")));

test("a child reads as its chat's row reads, with the work it started and what waits below it", () => {
  const busy = child(ended, { working: 1, waiting: 0 });

  expect(taskStatus(busy)).toBe("background");
  expect(taskLabel(taskStatus(busy))).toBe("Working in the background");
  expect(unfinishedTask(busy), "a child whose background still works is not finished").toBe(true);

  expect(taskStatus(child(ended, { working: 0, waiting: 1 }))).toBe("waiting");
  expect(taskStatus(child(ended, { working: 0, waiting: 0 }))).toBe("done");
});
