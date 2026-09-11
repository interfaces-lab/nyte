import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { workGroupBody } from "./work-group-body.ts";

describe("workGroupBody", () => {
  test("compact streams through a preview window and expands only when opened", () => {
    assert.equal(
      workGroupBody({ density: "compact", active: true, reveal: "default", hasContent: true }),
      "preview",
    );
    assert.equal(
      workGroupBody({ density: "compact", active: true, reveal: "closed", hasContent: true }),
      "preview",
    );
    assert.equal(
      workGroupBody({ density: "compact", active: true, reveal: "open", hasContent: true }),
      "list",
    );
    assert.equal(
      workGroupBody({ density: "compact", active: false, reveal: "default", hasContent: true }),
      "none",
    );
  });

  test("an empty compact run stays a header until there is something to scroll", () => {
    assert.equal(
      workGroupBody({ density: "compact", active: true, reveal: "default", hasContent: false }),
      "none",
    );
  });

  test("balanced opens while work is live; detailed stays open until closed", () => {
    assert.equal(
      workGroupBody({ density: "balanced", active: true, reveal: "default", hasContent: true }),
      "list",
    );
    assert.equal(
      workGroupBody({ density: "balanced", active: false, reveal: "default", hasContent: true }),
      "none",
    );
    assert.equal(
      workGroupBody({ density: "detailed", active: false, reveal: "default", hasContent: true }),
      "list",
    );
    assert.equal(
      workGroupBody({ density: "detailed", active: true, reveal: "closed", hasContent: true }),
      "none",
    );
  });
});
