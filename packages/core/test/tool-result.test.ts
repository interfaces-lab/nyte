/**
 * Invariant 31: a settled tool result is self-contained. A failed or aborted
 * tool keeps the last partial its `onUpdate` reported, a `ToolError` stays the
 * tool's own decision. Stream overlays are covered by kernel/sdk-events.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { ToolError, toolErrorResult } from "../src/utils/tool-result.ts";

test("a failure keeps the partial content, details, and title the error left blank", () => {
  const result = toolErrorResult(new Error("aborted"), {
    content: [{ type: "text", text: "partial stdout" }],
    details: { patch: "--- a/view.md\n+++ b/view.md" },
    title: "view.md",
  });

  assert.deepEqual(result, {
    content: [
      { type: "text", text: "aborted" },
      { type: "text", text: "partial stdout" },
    ],
    details: { patch: "--- a/view.md\n+++ b/view.md" },
    title: "view.md",
  });
});

test("a structured tool failure is the tool's own result object, untouched by the partial", () => {
  const structured = {
    content: [{ type: "text" as const, text: "exit 1" }],
    details: { code: 1 },
    title: "make",
  };
  assert.equal(
    toolErrorResult(new ToolError(structured), {
      content: [],
      details: { patch: "x" },
      title: "other",
    }),
    structured,
  );
});

test("partial details preserve valid falsy values; only a missing partial or details defaults", () => {
  assert.deepEqual(toolErrorResult(new Error("boom")), {
    content: [{ type: "text", text: "boom" }],
    details: {},
  });
  for (const details of [null, false, 0, "", [], { exitCode: 1 }, undefined]) {
    const result = toolErrorResult(new Error("stopped"), { content: [], details });
    assert.deepEqual(result.details, details === undefined ? {} : details);
    assert.equal("title" in result, false);
  }
});
