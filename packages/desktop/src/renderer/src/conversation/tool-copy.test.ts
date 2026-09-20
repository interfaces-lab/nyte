import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import { failureNotice, toolVerb } from "./tool-copy.ts";

const child = sessionId("child");

test("a verb names the class and its phase", () => {
  assert.equal(toolVerb({ kind: "file_read", path: "a" }, "running"), "Reading");
  assert.equal(toolVerb({ kind: "shell", command: "ls" }, "done"), "Ran");
  assert.equal(toolVerb({ kind: "shell", command: "ls" }, "failed"), "Command failed");
  assert.equal(toolVerb({ kind: "file_edit", path: "a" }, "interrupted"), "Edit stopped");
  assert.equal(
    toolVerb(
      { kind: "file_patch", op: "write", path: "a", added: 1, removed: 0, patch: "" },
      "done",
    ),
    "Wrote",
  );
  assert.equal(toolVerb({ kind: "custom", label: "Web search" }, "done"), "Web search");
  assert.equal(toolVerb({ kind: "custom", label: "Web search" }, "failed"), "Web search failed");
  assert.equal(
    toolVerb(
      { kind: "delegate", role: "create", target: { kind: "one", session: child } },
      "running",
    ),
    "Creating",
  );
  assert.equal(
    toolVerb({ kind: "delegate", role: "send", target: { kind: "one", session: child } }, "done"),
    "Sent to",
  );
  assert.equal(
    toolVerb(
      {
        kind: "delegate",
        role: "await",
        target: { kind: "many", sessions: [child], mode: "all" },
      },
      "done",
    ),
    "Waited for",
  );
  assert.equal(
    toolVerb({ kind: "delegate", role: "stop", target: { kind: "one", session: child } }, "failed"),
    "Stop failed",
  );
});

test("a failure reads as product copy by class; only provider text reaches the reader", () => {
  assert.deepEqual(failureNotice({ class: "aborted", message: "The operation was aborted." }), {
    text: "Run stopped.",
    tone: "neutral",
  });
  assert.deepEqual(failureNotice({ class: "rate_limit", message: "429 rate_limit_error" }), {
    text: "Rate limit reached. Try again shortly.",
    tone: "danger",
  });
  assert.deepEqual(failureNotice({ class: "provider", message: "  Model\n  rejected it " }), {
    text: "Model rejected it",
    tone: "danger",
  });
  assert.deepEqual(failureNotice({ class: "runner", message: " \n" }), {
    text: "Request failed.",
    tone: "danger",
  });
  const long = failureNotice({ class: "provider", message: "x".repeat(400) }).text;
  assert.equal(long.length, 178);
  assert.ok(long.endsWith("…"));
});
