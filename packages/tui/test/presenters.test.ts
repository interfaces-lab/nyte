/**
 * The TUI's presenter refiners compose over core's base presentation
 * (design.mdx, "Presentation"): the base must stand alone, a refiner only
 * sharpens. These tests drive the composed presenter, not the refiners.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { presenter } from "../src/presenters.ts";

void describe("presenters", () => {
  void test("a settled task call summarizes as delegate and outcome", () => {
    const shown = presenter.tool({
      toolName: "task",
      args: { agent: "general", prompt: "Count the ducks." },
      result: {
        output: "seven ducks",
        title: "general",
        isError: false,
        details: { agent: "general", childSessionId: "s_task_abc", state: "completed" },
      },
    });
    assert.equal(shown.summary, "general · completed");
    assert.equal(shown.title, "general");
  });

  void test("a task call without details falls back to the base presentation", () => {
    const base = presenter.tool({ toolName: "task", args: { agent: "general" } });
    assert.equal(base.name, "task");
    assert.equal(base.summary, undefined);
  });
});
