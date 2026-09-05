/**
 * Invariant 31: a settled tool result is self-contained. A failed or aborted
 * tool keeps the last partial its `onUpdate` reported, a `ToolError` stays the
 * tool's own decision. Stream overlays are covered by kernel/sdk-events.test.ts.
 */
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { ToolError, toolErrorResult } from "../src/utils/tool-result.ts";

describe("toolErrorResult with a last partial", () => {
  test("keeps partial content, details, and title the error left blank", () => {
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

  test("never overrides details or title the error already settled", () => {
    const structured = new ToolError({
      content: [{ type: "text", text: "exit 1" }],
      details: { code: 1 },
      title: "make",
    });

    assert.deepEqual(
      toolErrorResult(structured, { content: [], details: { patch: "x" }, title: "other" }),
      {
        content: [{ type: "text", text: "exit 1" }],
        details: { code: 1 },
        title: "make",
      },
    );
  });

  test("normalizes a plain failure without a partial result", () => {
    assert.deepEqual(toolErrorResult(new Error("boom")), {
      content: [{ type: "text", text: "boom" }],
      details: {},
    });
  });
});

test("partial details preserve valid falsy values and default only undefined", () => {
  for (const details of [null, false, 0, "", [], { exitCode: 1 }, undefined]) {
    const result = toolErrorResult(new Error("stopped"), { content: [], details });
    assert.deepEqual(result.details, details === undefined ? {} : details);
    assert.equal("title" in result, false);
  }
});

test("a structured tool failure preserves the original result object", () => {
  const result = { content: [], details: { exitCode: 1 } };
  assert.equal(toolErrorResult(new ToolError(result), { content: [], details: null }), result);
});
