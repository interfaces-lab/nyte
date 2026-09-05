import assert from "node:assert/strict";
import { expect, expectTypeOf, test } from "vitest";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { StringEnum } from "../src/utils/typebox-helpers.ts";

test("StringEnum retains its literal type and accepts only its declared strings", () => {
  const schema = StringEnum(["add", "remove"]);
  expectTypeOf<Static<typeof schema>>().toEqualTypeOf<"add" | "remove">();
  assert.ok(Value.Check(schema, "add"));
  assert.ok(Value.Check(schema, "remove"));
  assert.ok(!Value.Check(schema, "other"));
  assert.ok(!Value.Check(schema, 1));
  expect(schema).toMatchObject({ type: "string" });
});

test("StringEnum preserves an empty-string default and description on the wire", () => {
  const schema = StringEnum(["", "auto"], { default: "", description: "" });
  const wire: unknown = JSON.parse(JSON.stringify(schema));
  expect(wire).toMatchObject({ default: "", description: "" });
  assert.ok(Value.Check(schema, ""));
});
