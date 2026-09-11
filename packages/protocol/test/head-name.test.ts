import assert from "node:assert/strict";
import { test } from "vitest";
import { Value } from "typebox/value";
import { isHeadName } from "../src/names.ts";
import { HeadName } from "../src/schemas.ts";
import { OPERATIONS } from "../src/operations.ts";

test("non-string heads cannot enter the protocol through coercion", () => {
  for (const head of [123, ["main"], { toString: () => "main" }]) {
    assert.equal(isHeadName(head), false);
    assert.equal(Value.Check(HeadName, head), false);
    assert.equal(
      Value.Check(OPERATIONS["messages.send"].input, { sessionId: "s", head, content: "hi" }),
      false,
    );
    assert.equal(
      Value.Check(OPERATIONS["sessions.configure"].input, { sessionId: "s", head, agent: "a" }),
      false,
    );
  }
});

test.each([
  "",
  "a/b",
  ".hidden",
  "tail.",
  "a..b",
  "a@{b",
  "@",
  "x.lock",
  ...Array.from({ length: 33 }, (_, code) => `a${String.fromCharCode(code)}b`),
  "a\u007fb",
  "a~b",
  "a^b",
  "a:b",
  "a?b",
  "a*b",
  "a[b",
  "a\\b",
  "a\n",
  "a\u2028..b",
  "a\u2029@{b",
  "a\u2028.lock",
])("rejects invalid head %j at protocol admission", (head) => {
  assert.equal(isHeadName(head), false);
  assert.equal(Value.Check(HeadName, head), false);
  assert.equal(
    Value.Check(OPERATIONS["messages.send"].input, { sessionId: "s", head, content: "hi" }),
    false,
  );
  assert.equal(
    Value.Check(OPERATIONS["sessions.configure"].input, { sessionId: "s", head, agent: "a" }),
    false,
  );
});

test.each([
  "main",
  "日本語",
  "é+😀",
  "a!#$%&'()+,;=]{}",
  "a\u2028.b",
  "a.\u2029",
  "a\u0085b",
  "a@b",
  "x.LOCK",
])("accepts valid head %j without an ASCII-only restriction", (head) => {
  assert.equal(isHeadName(head), true);
  assert.equal(Value.Check(HeadName, head), true);
  assert.equal(
    Value.Check(OPERATIONS["messages.send"].input, { sessionId: "s", head, content: "hi" }),
    true,
  );
});
