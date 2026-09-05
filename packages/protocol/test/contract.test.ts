/**
 * The schemas against values the SDK produces and values an attacker sends.
 * The type-level proof that each schema matches its interface runs in `tsc`
 * at every `typed<T>()` call; these are the runtime facts a type cannot state.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { Value } from "typebox/value";
import { validationIssues, describeIssues } from "../src/parse.ts";
import * as schemas from "../src/schemas.ts";
import { VERBS, parseVerb } from "../src/verbs.ts";
import { CallReplySchema, WireErrorSchema, statusFor, type ErrorCode } from "../src/wire.ts";
import type { SessionEvent } from "../src/sdk.ts";

test("a fact event whose value was deleted arrives without a value key and is still an event", () => {
  const deleted: SessionEvent = { seq: 4, kind: "fact", key: "name", value: undefined };
  const wire: unknown = JSON.parse(JSON.stringify(deleted));
  assert.deepEqual(wire, { seq: 4, kind: "fact", key: "name" });
  assert.ok(Value.Check(schemas.SessionEvent, wire));
  assert.equal(wire.kind, "fact");
});

test("a commit event carries the whole message, and a mangled one is refused with a path", () => {
  const event: SessionEvent = {
    seq: 9,
    kind: "commit",
    head: "main",
    item: {
      oid: "abc",
      commit: {
        kind: "commit",
        parent: null,
        body: { kind: "message", message: { role: "user", content: "hi", timestamp: 1 } },
        at: 1,
      },
    },
  };
  assert.ok(Value.Check(schemas.SessionEvent, JSON.parse(JSON.stringify(event))));
  const broken = {
    ...event,
    item: { oid: "abc", commit: { ...event.item.commit, body: { kind: "message", message: 5 } } },
  };
  assert.ok(!Value.Check(schemas.SessionEvent, broken));
  const issues = validationIssues(Value.Errors(schemas.SessionEvent, broken));
  assert.ok(issues.some((issue) => issue.path.startsWith("/item/commit/body")));
});

test("strict inputs refuse unknown keys, including an own __proto__ key parsed from JSON", () => {
  const input = VERBS["sessions.get"].input;
  assert.ok(Value.Check(input, { sessionId: "s" }));
  assert.ok(!Value.Check(input, { sessionId: "s", extra: 1 }));
  assert.ok(!Value.Check(input, JSON.parse('{"sessionId":"s","__proto__":{"x":1}}')));
  assert.ok(!Value.Check(input, { sessionId: "" }));
});

test("JsonValue refuses undefined at any depth and accepts nested JSON", () => {
  assert.ok(Value.Check(schemas.JsonValue, { a: [1, "b", { c: null }] }));
  assert.ok(!Value.Check(schemas.JsonValue, { a: [1, undefined] }));
  assert.ok(!Value.Check(schemas.JsonValue, undefined));
});

test("optional-input verbs accept undefined and void verbs accept only undefined", () => {
  assert.ok(Value.Check(VERBS["sessions.list"].input, undefined));
  assert.ok(Value.Check(VERBS["sessions.list"].input, { limit: 2 }));
  assert.ok(!Value.Check(VERBS["sessions.list"].input, { limit: 1.5 }));
  assert.ok(!Value.Check(VERBS["sessions.list"].input, null));
  assert.ok(Value.Check(VERBS["sessions.rename"].output, undefined));
  assert.ok(!Value.Check(VERBS["sessions.rename"].output, null));
  assert.ok(Value.Check(VERBS["sessions.get"].output, undefined));
  assert.ok(!Value.Check(VERBS["plugins.catalog"].output, undefined));
});

test("verb lookup never walks the prototype chain", () => {
  assert.equal(parseVerb("constructor"), undefined);
  assert.equal(parseVerb("__proto__"), undefined);
  assert.equal(parseVerb("toString"), undefined);
  assert.equal(parseVerb("messages.send"), "messages.send");
});

test("reply envelopes distinguish an undefined value from null, and every error code has a status", () => {
  assert.ok(Value.Check(CallReplySchema, { ok: true, defined: false }));
  assert.ok(Value.Check(CallReplySchema, { ok: true, defined: true, value: null }));
  assert.ok(!Value.Check(CallReplySchema, { ok: true }));
  assert.ok(!Value.Check(CallReplySchema, { ok: false, error: { code: "made_up", message: "x" } }));
  const codes: readonly ErrorCode[] = [
    "invalid_input",
    "cursor_expired",
    "unknown_verb",
    "unknown_session",
    "not_found",
    "method_not_allowed",
    "unsupported_media_type",
    "payload_too_large",
    "unauthorized",
    "forbidden",
    "closed",
    "internal",
  ];
  for (const code of codes) assert.ok(statusFor(code) >= 400 && statusFor(code) < 600, code);
  assert.ok(Value.Check(WireErrorSchema, { code: "cursor_expired", message: "m", floor: 3 }));
  assert.ok(!Value.Check(WireErrorSchema, { code: "cursor_expired", message: "m" }));
});

test("validation diagnostics are bounded and readable", () => {
  const errors = Value.Errors(schemas.SessionId, "");
  const issues = validationIssues(errors);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.path, "");
  assert.ok(describeIssues(issues).startsWith("/: "));
  assert.equal(describeIssues([]), "value did not match its schema");
  assert.equal(validationIssues(Array.from({ length: 30 }, () => errors).flat()).length, 20);
});
