import assert from "node:assert/strict";
import { test } from "node:test";
import { sandboxReplyFor } from "./provider.ts";

function userPrompt(content: string): string {
  return JSON.stringify({ messages: [{ role: "user", content }] });
}

function afterTool(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    messages: [
      { role: "user", content: "x" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
    ],
  });
}

test("prefix steers still win over the coding session", () => {
  const think = sandboxReplyFor(userPrompt("think about it"));
  assert.equal(think.tool, undefined);
  assert.equal(think.text, "Here is the answer, with the reasoning above it.");

  const bash = sandboxReplyFor(userPrompt("bash echo hi"));
  assert.equal(bash.tool?.name, "bash");
  assert.deepEqual(bash.tool?.arguments, { command: "echo hi" });
});

test("a health-route inspect reads src/server.ts", () => {
  const reply = sandboxReplyFor(
    userPrompt("prod /health is flaking. look at src/server.ts. is the route matching any method?"),
  );
  assert.equal(reply.tool?.name, "read");
  assert.deepEqual(reply.tool?.arguments, { path: "src/server.ts" });
  assert.equal(reply.text, "I'll read the handler.");
});

test("GET only edits the health branch", () => {
  const reply = sandboxReplyFor(userPrompt("yeah, GET only"));
  assert.equal(reply.tool?.name, "edit");
  assert.equal(reply.text, "I'll restrict it to GET.");
});

test("asking whether the file parses runs node --check", () => {
  const reply = sandboxReplyFor(userPrompt("does the file still parse?"));
  assert.equal(reply.tool?.name, "bash");
  assert.deepEqual(reply.tool?.arguments, {
    command: "node --check src/server.ts && echo ok",
  });
});

test("after-tool follow-ups name the result instead of Done", () => {
  const read = sandboxReplyFor(afterTool("read", { path: "src/server.ts" }));
  assert.match(read.text ?? "", /no method check/);
  assert.doesNotMatch(read.text ?? "", /Done\./);

  const edit = sandboxReplyFor(afterTool("edit", { path: "src/server.ts" }));
  assert.match(edit.text ?? "", /GET \/health/);

  const check = sandboxReplyFor(
    afterTool("bash", { command: "node --check src/server.ts && echo ok" }),
  );
  assert.equal(check.text, "It parses.");
});

test("unscripted tools still answer Done so prefix QA stays stable", () => {
  const reply = sandboxReplyFor(afterTool("bash", { command: "echo hi" }));
  assert.equal(reply.text, "Done.");
});
