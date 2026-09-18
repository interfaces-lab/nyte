import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { ToolTurnPart, TurnPart } from "@nyte-ai/protocol";
import {
  displayTranscriptParts,
  formatRunDuration,
  toolPhase,
  userDisplayText,
  userTextSegments,
} from "./transcript-presentation.ts";

const assistant = (commit: string, contentIndex: number, text: string): TurnPart => ({
  kind: "assistant",
  commit,
  contentIndex,
  text,
});
const read = (callId: string): ToolTurnPart => ({
  kind: "tool",
  callId,
  class: { kind: "file_read", path: "README.md" },
});

describe("transcript presentation", () => {
  test("an episode holds reasoning and tools; narration stands on its own", () => {
    const user: TurnPart = { kind: "user", commit: "u", parent: null, content: "Please fix it" };
    const thought: TurnPart = { kind: "thinking", commit: "a", contentIndex: 0, text: "Looking" };
    const commentary = assistant("a", 1, "I am checking the files.");
    const tool = read("read");
    const response = assistant("b", 0, "Fixed it.");

    assert.deepEqual(displayTranscriptParts([user, thought, commentary, tool, response]), [
      { kind: "part", part: user },
      { kind: "work", parts: [thought] },
      { kind: "response", parts: [commentary] },
      { kind: "work", parts: [tool] },
      { kind: "response", parts: [response] },
    ]);
  });

  /**
   * The reader must never watch text move. Text arrives before the parts that
   * follow it, so its row has to be decided without them.
   */
  test("a part's placement never changes as the turn grows", () => {
    const narration = assistant("a", 0, "Let me check the config.");
    const tool = read("read");
    const answer = assistant("b", 0, "Found it.");
    const growing = [narration, tool, answer, read("again")];

    const placement = (parts: readonly TurnPart[], part: TurnPart): string | undefined =>
      displayTranscriptParts(parts).find((row) =>
        row.kind === "part" ? row.part === part : row.parts.some((each) => each === part),
      )?.kind;

    for (const [index, part] of growing.entries()) {
      const first = placement(growing.slice(0, index + 1), part);
      for (let length = index + 2; length <= growing.length; length += 1) {
        assert.equal(placement(growing.slice(0, length), part), first, `part ${index} moved`);
      }
    }
  });

  test("a tool-ending failed turn keeps its narration in the transcript", () => {
    const commentary = assistant("a", 0, "Checking one more thing.");
    const tool = read("read");
    assert.deepEqual(displayTranscriptParts([commentary, tool]), [
      { kind: "response", parts: [commentary] },
      { kind: "work", parts: [tool] },
    ]);
  });

  test("a tool call after an answer does not pull the answer into the episode", () => {
    const answer = assistant(
      "a",
      0,
      "Found the actual cause, and it's a config bug:\n\n- `app.json` hardcodes the group\n- `app.config.ts` spreads it into every variant",
    );
    const tool: TurnPart = {
      kind: "tool",
      callId: "edit",
      class: { kind: "file_edit", path: "app.json" },
    };

    assert.deepEqual(displayTranscriptParts([answer, tool]), [
      { kind: "response", parts: [answer] },
      { kind: "work", parts: [tool] },
    ]);
  });

  test("a delegation splits the episode around it", () => {
    const spawn: TurnPart = {
      kind: "tool",
      callId: "task",
      class: { kind: "delegate", role: "spawn", title: "Map the workbench" },
    };
    const wait: TurnPart = {
      kind: "tool",
      callId: "wait",
      class: { kind: "delegate", role: "await", jobId: "job-1" },
    };
    assert.deepEqual(displayTranscriptParts([read("a"), spawn, read("b"), wait]), [
      { kind: "work", parts: [read("a")] },
      { kind: "part", part: spawn },
      { kind: "work", parts: [read("b")] },
      { kind: "part", part: wait },
    ]);
  });

  test("a call's phase follows its result, else the run it belongs to", () => {
    const pending = read("read");
    assert.equal(toolPhase(pending, true), "running");
    assert.equal(toolPhase(pending, false), "interrupted");
    const settle = (isError: boolean): ToolTurnPart => ({
      ...pending,
      result: { commit: "r", output: "", isError },
    });
    assert.equal(toolPhase(settle(false), true), "done");
    assert.equal(toolPhase(settle(true), true), "failed");
  });

  test("assistant-only turns remain one response", () => {
    const first = assistant("a", 0, "One");
    const second = assistant("a", 1, "Two");
    assert.deepEqual(displayTranscriptParts([first, second]), [
      { kind: "response", parts: [first, second] },
    ]);
  });

  test("skill references keep their label and hide their persisted path", () => {
    const source =
      "Use [$principle-laziness-protocol](/Users/me/.agents/skills/principle-laziness-protocol/SKILL.md) now";
    assert.equal(userDisplayText(source), "Use /principle-laziness-protocol now");
    assert.deepEqual(userTextSegments(source), [
      { kind: "text", text: "Use " },
      {
        kind: "reference",
        label: "/principle-laziness-protocol",
        target: "/Users/me/.agents/skills/principle-laziness-protocol/SKILL.md",
      },
      { kind: "text", text: " now" },
    ]);
  });

  test("expanded TUI skill instructions become a compact transcript label", () => {
    const source = [
      '<skill name="review" location="/Users/me/.agents/skills/review/SKILL.md">',
      "References are relative to /Users/me/.agents/skills/review.",
      "",
      "# Review",
      "Inspect every changed file.",
      "</skill>",
      "",
      "Fix the regression.",
    ].join("\n");

    assert.equal(userDisplayText(source), "/review\nFix the regression.");
    assert.deepEqual(userTextSegments(source), [
      {
        kind: "reference",
        label: "/review",
        target: "/Users/me/.agents/skills/review/SKILL.md",
      },
      { kind: "text", text: "\nFix the regression." },
    ]);
  });

  test("durations use compact stable labels", () => {
    assert.equal(formatRunDuration(0), undefined);
    assert.equal(formatRunDuration(37_000), "37s");
    assert.equal(formatRunDuration(637_000), "10m 37s");
    assert.equal(formatRunDuration(3_660_000), "1h 1m");
  });
});
