import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { Tool, ToolCall } from "@nyte-ai/schema/model";
import { validateToolArguments } from "../src/utils/validation.ts";

function createToolCallWithPlainSchema(
  schema: Tool["parameters"],
  value: unknown,
): {
  tool: Tool;
  toolCall: ToolCall;
} {
  const tool: Tool = {
    name: "echo",
    description: "Echo tool",
    parameters: {
      type: "object",
      properties: {
        value: schema,
      },
      required: ["value"],
    },
  };

  const toolCall: ToolCall = {
    type: "toolCall",
    id: "tool-1",
    name: "echo",
    arguments: { value },
  };

  return { tool, toolCall };
}

describe("validateToolArguments", () => {
  test("still validates when Function constructor is unavailable", () => {
    const tool: Tool = {
      name: "echo",
      description: "Echo tool",
      parameters: Type.Object({
        count: Type.Number(),
      }),
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tool-1",
      name: "echo",
      arguments: { count: "42" },
    };

    vi.stubGlobal("Function", () => {
      throw new EvalError("Code generation from strings disallowed for this context");
    });

    try {
      assert.deepEqual(validateToolArguments(tool, toolCall), { count: 42 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("coerces serialized plain JSON schemas with AJV-compatible primitive rules", () => {
    const passingCases: Array<{
      schema: Tool["parameters"];
      input: unknown;
      expected: unknown;
    }> = [
      { schema: { type: "number" }, input: "42", expected: 42 },
      { schema: { type: "number" }, input: true, expected: 1 },
      { schema: { type: "number" }, input: null, expected: 0 },
      { schema: { type: "integer" }, input: "42", expected: 42 },
      { schema: { type: "boolean" }, input: "true", expected: true },
      { schema: { type: "boolean" }, input: "false", expected: false },
      { schema: { type: "boolean" }, input: 1, expected: true },
      { schema: { type: "boolean" }, input: 0, expected: false },
      { schema: { type: "string" }, input: null, expected: "" },
      { schema: { type: "string" }, input: true, expected: "true" },
      { schema: { type: "null" }, input: "", expected: null },
      { schema: { type: "null" }, input: 0, expected: null },
      { schema: { type: "null" }, input: false, expected: null },
      {
        schema: { type: ["number", "string"] },
        input: "1",
        expected: "1",
      },
      {
        schema: { type: ["boolean", "number"] },
        input: "1",
        expected: 1,
      },
    ];

    for (const testCase of passingCases) {
      const { tool, toolCall } = createToolCallWithPlainSchema(testCase.schema, testCase.input);
      assert.deepEqual(validateToolArguments(tool, toolCall), { value: testCase.expected });
    }
  });

  test("treats null as omission for optional non-nullable properties", () => {
    const tool: Tool = {
      name: "echo",
      description: "Echo tool",
      parameters: Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Number()),
        nullable: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        metadata: Type.Object({ enabled: Type.Optional(Type.Boolean()) }),
      }),
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tool-1",
      name: "echo",
      arguments: { path: "file.txt", offset: null, nullable: null, metadata: { enabled: null } },
    };

    assert.deepEqual(validateToolArguments(tool, toolCall), {
      path: "file.txt",
      nullable: null,
      metadata: {},
    });
  });

  test("preserves optional nulls whose referenced schema is nullable", () => {
    const tool: Tool = {
      name: "echo",
      description: "Echo tool",
      parameters: {
        type: "object",
        properties: { value: { $ref: "#/$defs/value" } },
        $defs: { value: { anyOf: [{ type: "number" }, { type: "null" }] } },
      },
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tool-1",
      name: "echo",
      arguments: { value: null },
    };

    assert.deepEqual(validateToolArguments(tool, toolCall), { value: null });
  });

  test("preserves a value that already matches a oneOf nullable union arm", () => {
    const { tool, toolCall } = createToolCallWithPlainSchema(
      { oneOf: [{ type: "number" }, { type: "null" }] },
      null,
    );

    assert.deepEqual(validateToolArguments(tool, toolCall), { value: null });
  });

  test("still coerces nullable unions when the original value does not match any arm", () => {
    const { tool, toolCall } = createToolCallWithPlainSchema(
      { anyOf: [{ type: "number" }, { type: "null" }] },
      "42",
    );

    assert.deepEqual(validateToolArguments(tool, toolCall), { value: 42 });
  });

  test("accepts null for nullable array schemas with items in the generated validator, which the CSP fallback above bypasses", () => {
    const { tool, toolCall } = createToolCallWithPlainSchema(
      { type: ["array", "null"], items: { type: "string" } },
      null,
    );
    // oxlint-disable-next-line no-implied-eval -- exercises TypeBox's generated validator
    const generatedCheck: unknown = new Function(Compile(tool.parameters).Code())();

    assert.ok(generatedCheck instanceof Function);
    assert.equal(generatedCheck(toolCall.arguments), true);
    assert.deepEqual(validateToolArguments(tool, toolCall), { value: null });
  });

  test("rejects invalid coercions for serialized plain JSON schemas", () => {
    const failingCases: Array<{
      schema: Tool["parameters"];
      input: unknown;
    }> = [
      { schema: { type: "boolean" }, input: "1" },
      { schema: { type: "null" }, input: "null" },
      { schema: { type: "integer" }, input: "42.1" },
    ];

    for (const testCase of failingCases) {
      const { tool, toolCall } = createToolCallWithPlainSchema(testCase.schema, testCase.input);
      assert.throws(() => validateToolArguments(tool, toolCall), /Validation failed/);
    }
  });
});
