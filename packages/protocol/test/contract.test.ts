/**
 * The schemas against values the SDK produces and values an attacker sends.
 * The type-level proof that each schema matches its interface runs in `tsc`
 * at every `typed<T>()` call; these are the runtime facts a type cannot state.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { decode } from "../src/parse.ts";
import * as schemas from "../src/schemas.ts";
import { VERBS, VERB_NAMES, isVerb } from "../src/verbs.ts";
import { CallReplySchema, WireErrorSchema, statusFor, type ErrorCode } from "../src/wire.ts";
import type { SessionEvent } from "../src/sdk.ts";

test("a fact event whose value was deleted arrives without a value key and is still an event", () => {
  const deleted: SessionEvent = { seq: 4, kind: "fact", key: "name", value: undefined };
  const wire: unknown = JSON.parse(JSON.stringify(deleted));
  assert.deepEqual(wire, { seq: 4, kind: "fact", key: "name" });
  const decoded = decode(schemas.SessionEvent, wire);
  assert.ok(decoded.ok);
  assert.equal(decoded.value.kind, "fact");
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
  assert.ok(decode(schemas.SessionEvent, JSON.parse(JSON.stringify(event))).ok);
  const broken = decode(schemas.SessionEvent, {
    ...event,
    item: { oid: "abc", commit: { ...event.item.commit, body: { kind: "message", message: 5 } } },
  });
  assert.ok(!broken.ok);
  assert.ok(broken.issues.some((issue) => issue.path.startsWith("/item/commit/body")));
});

test("strict inputs refuse unknown keys, including an own __proto__ key parsed from JSON", () => {
  const input = VERBS["sessions.get"].input;
  assert.ok(decode(input, { sessionId: "s" }).ok);
  assert.ok(!decode(input, { sessionId: "s", extra: 1 }).ok);
  assert.ok(!decode(input, JSON.parse('{"sessionId":"s","__proto__":{"x":1}}')).ok);
  assert.ok(!decode(input, { sessionId: "" }).ok);
});

test("JsonValue refuses undefined at any depth and accepts nested JSON", () => {
  assert.ok(decode(schemas.JsonValue, { a: [1, "b", { c: null }] }).ok);
  assert.ok(!decode(schemas.JsonValue, { a: [1, undefined] }).ok);
  assert.ok(!decode(schemas.JsonValue, undefined).ok);
});

test("optional-input verbs accept undefined and void verbs accept only undefined", () => {
  assert.ok(decode(VERBS["sessions.list"].input, undefined).ok);
  assert.ok(decode(VERBS["sessions.list"].input, { limit: 2 }).ok);
  assert.ok(!decode(VERBS["sessions.list"].input, { limit: 1.5 }).ok);
  assert.ok(!decode(VERBS["sessions.list"].input, null).ok);
  assert.ok(decode(VERBS["sessions.rename"].output, undefined).ok);
  assert.ok(!decode(VERBS["sessions.rename"].output, null).ok);
  assert.ok(decode(VERBS["sessions.get"].output, undefined).ok);
  assert.ok(!decode(VERBS["plugins.catalog"].output, undefined).ok);
});

test("verb lookup never walks the prototype chain", () => {
  assert.equal(isVerb("constructor"), false);
  assert.equal(isVerb("__proto__"), false);
  assert.equal(isVerb("toString"), false);
  assert.ok(isVerb("messages.send"));
  assert.ok(VERB_NAMES.includes("messages.send"));
});

test("reply envelopes distinguish an undefined value from null, and every error code has a status", () => {
  assert.ok(decode(CallReplySchema, { ok: true, defined: false }).ok);
  assert.ok(decode(CallReplySchema, { ok: true, defined: true, value: null }).ok);
  assert.ok(!decode(CallReplySchema, { ok: true }).ok);
  assert.ok(!decode(CallReplySchema, { ok: false, error: { code: "made_up", message: "x" } }).ok);
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
  assert.ok(decode(WireErrorSchema, { code: "cursor_expired", message: "m", floor: 3 }).ok);
  assert.ok(!decode(WireErrorSchema, { code: "cursor_expired", message: "m" }).ok);
});
