import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { TurnPart } from "@nyte-ai/core";
import {
  displayTranscriptParts,
  formatRunDuration,
  presentTranscriptNotice,
  userDisplayText,
  userTextSegments,
} from "./transcript-presentation.ts";

const assistant = (commit: string, contentIndex: number, text: string): TurnPart => ({
  kind: "assistant",
  commit,
  contentIndex,
  text,
});

describe("transcript presentation", () => {
  test("an episode holds reasoning and tools; narration stands on its own", () => {
    const user: TurnPart = { kind: "user", commit: "u", parent: null, content: "Please fix it" };
    const thought: TurnPart = { kind: "thinking", commit: "a", contentIndex: 0, text: "Looking" };
    const commentary = assistant("a", 1, "I am checking the files.");
    const tool: TurnPart = { kind: "tool", callId: "read", toolName: "read" };
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
    const tool: TurnPart = { kind: "tool", callId: "read", toolName: "read" };
    const note: TurnPart = { kind: "note", commit: "n", text: "Request failed." };
    const answer = assistant("b", 0, "Found it.");
    const growing = [narration, tool, answer, note];

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
    const tool: TurnPart = { kind: "tool", callId: "read", toolName: "read" };
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
    const tool: TurnPart = { kind: "tool", callId: "edit", toolName: "edit" };

    assert.deepEqual(displayTranscriptParts([answer, tool]), [
      { kind: "response", parts: [answer] },
      { kind: "work", parts: [tool] },
    ]);
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

  test("provider errors become concise product copy while retaining diagnostics", () => {
    const source =
      'Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Try later"},"request_id":"req_secret"}';
    assert.deepEqual(presentTranscriptNotice(source), {
      text: "Rate limit reached. Try again shortly.",
      tone: "danger",
      detail: source,
    });
    assert.deepEqual(presentTranscriptNotice("Error: The operation was aborted."), {
      text: "Run stopped.",
      tone: "neutral",
      detail: "Error: The operation was aborted.",
    });
  });

  test("durations use compact stable labels", () => {
    assert.equal(formatRunDuration(0), undefined);
    assert.equal(formatRunDuration(37_000), "37s");
    assert.equal(formatRunDuration(637_000), "10m 37s");
    assert.equal(formatRunDuration(3_660_000), "1h 1m");
  });
});
