import { Type } from "typebox";
import {
  IsAdditionalProperties,
  IsAnyOf,
  IsConst,
  IsEnum,
  IsItems,
  IsProperties,
  IsRequired,
  IsSchemaObject,
  IsType,
  type XSchema,
  type XSchemaObject,
} from "typebox/schema";
import { Value } from "typebox/value";
import type { Tool, ToolCall } from "../types.ts";

class UnsupportedStrictJsonSchemaError extends Error {}

const UNSUPPORTED_STRICT_SCHEMA_KEYS = [
  "$ref",
  "$defs",
  "definitions",
  "allOf",
  "oneOf",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
  "unevaluatedProperties",
  "propertyNames",
  "contains",
  "prefixItems",
  "not",
  "if",
  "then",
  "else",
] as const;

function schemaTypes(schema: XSchemaObject): readonly string[] {
  return IsType(schema) ? [schema.type].flat() : [];
}

function isStructuredSchema(schema: XSchema): boolean {
  if (!IsSchemaObject(schema)) return false;

  const types = schemaTypes(schema);

  return (
    types.includes("object") ||
    types.includes("array") ||
    "properties" in schema ||
    "items" in schema
  );
}

function schemaAllowsNull(schema: XSchema): boolean {
  if (!IsSchemaObject(schema)) return false;

  if (schemaTypes(schema).includes("null")) return true;

  if ((IsConst(schema) && schema.const === null) || (IsEnum(schema) && schema.enum.includes(null)))
    return true;

  return IsAnyOf(schema) && schema.anyOf.some((variant) => schemaAllowsNull(variant));
}

function makeJsonSchemaNodeStrict(schema: XSchema): void {
  if (!IsSchemaObject(schema)) {
    throw new UnsupportedStrictJsonSchemaError("boolean schemas are unsupported");
  }

  for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
    if (key in schema) {
      throw new UnsupportedStrictJsonSchemaError(`${key} schemas are unsupported`);
    }
  }

  if ("anyOf" in schema) {
    if (!IsAnyOf(schema) || schema.anyOf.length === 0) {
      throw new UnsupportedStrictJsonSchemaError("anyOf must contain at least one schema");
    }

    for (const variant of schema.anyOf) {
      if (isStructuredSchema(variant)) {
        throw new UnsupportedStrictJsonSchemaError("object and array unions are unsupported");
      }

      makeJsonSchemaNodeStrict(variant);
    }
  }

  if ("items" in schema) {
    if (!IsItems(schema)) {
      throw new UnsupportedStrictJsonSchemaError("items must be a schema");
    }

    if (Array.isArray(schema.items)) {
      throw new UnsupportedStrictJsonSchemaError("tuple schemas are unsupported");
    }

    makeJsonSchemaNodeStrict(schema.items);
  }

  const isObjectSchema = IsType(schema) && schema.type === "object";

  if ("properties" in schema && !isObjectSchema) {
    throw new UnsupportedStrictJsonSchemaError("properties require type object");
  }

  if (!isObjectSchema) return;

  if (
    "additionalProperties" in schema &&
    !(IsAdditionalProperties(schema) && schema.additionalProperties === false)
  ) {
    throw new UnsupportedStrictJsonSchemaError(
      "schema-valued or true additionalProperties is unsupported",
    );
  }

  if ("properties" in schema && !IsProperties(schema)) {
    throw new UnsupportedStrictJsonSchemaError("object properties must be a schema map");
  }

  if ("required" in schema && !IsRequired(schema)) {
    throw new UnsupportedStrictJsonSchemaError("object required must be a string array");
  }

  const properties = IsProperties(schema) ? schema.properties : {};
  const propertyNames = Object.keys(properties);
  const required = new Set(IsRequired(schema) ? schema.required : []);

  if ([...required].some((key) => !propertyNames.includes(key))) {
    throw new UnsupportedStrictJsonSchemaError("required contains an unknown property");
  }

  for (const [key, property] of Object.entries(properties)) {
    makeJsonSchemaNodeStrict(property);

    if (!required.has(key) && !schemaAllowsNull(property)) {
      properties[key] = { anyOf: [property, { type: "null" }] };
    }
  }

  Object.assign(schema, { required: propertyNames, additionalProperties: false });
}

/** Convert a tool schema to the strict subset expected by provider constrained sampling. */
function makeStrictJsonSchema(schema: Tool["parameters"]): XSchemaObject {
  const cloned = structuredClone(schema);

  if (!IsSchemaObject(cloned)) {
    throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
  }

  makeJsonSchemaNodeStrict(cloned);

  if (!IsType(cloned) || cloned.type !== "object") {
    throw new UnsupportedStrictJsonSchemaError("root schema must have type object");
  }

  return cloned;
}

export function getJsonSchemaToolParameters(tool: Tool, strict: boolean | undefined) {
  return { ...(strict === true ? makeStrictJsonSchema(tool.parameters) : tool.parameters) };
}

export interface GrammarConstrainedSampling {
  format: "lark" | "regex";
  definition: string;
  inputProperty: string;
}

export interface GrammarToolInputJsonBuffer {
  input: string;
  started: boolean;
  closed: boolean;
}

export function getGrammarToolInput(
  toolName: string,
  arguments_: ToolCall["arguments"],
  inputProperty: string,
): string {
  if (!Value.Check(Type.Object({ [inputProperty]: Type.String() }), arguments_)) {
    throw new Error(
      `Grammar tool call "${toolName}" requires argument "${inputProperty}" to be a string.`,
    );
  }

  return arguments_[inputProperty];
}

export function appendGrammarToolInputJsonDelta(
  buffer: GrammarToolInputJsonBuffer,
  inputProperty: string,
  nextInput: string,
  close: boolean,
): string | undefined {
  if (buffer.closed) {
    if (close && nextInput === buffer.input) return undefined;
    throw new Error(
      `grammar tool input for property "${inputProperty}" changed after it was closed`,
    );
  }

  if (!nextInput.startsWith(buffer.input)) {
    throw new Error(`grammar tool input for property "${inputProperty}" changed non-monotonically`);
  }

  const inputDelta = nextInput.slice(buffer.input.length);

  if (!close && inputDelta.length === 0) return undefined;

  let delta = "";

  if (!buffer.started) {
    delta += `{${JSON.stringify(inputProperty)}:"`;
    buffer.started = true;
  }

  delta += JSON.stringify(inputDelta).slice(1, -1);
  buffer.input = nextInput;

  if (close) {
    delta += '"}';
    buffer.closed = true;
  }

  return delta;
}

function inferGrammarInputProperty(tool: Tool): string {
  const schema = tool.parameters;

  if (!IsSchemaObject(schema) || !IsType(schema) || schema.type !== "object") {
    throw new Error("grammar constrained sampling requires an object parameter schema");
  }

  if (!IsRequired(schema) || schema.required.length !== 1) {
    throw new Error("grammar constrained sampling requires exactly one required string property");
  }

  const [inputProperty] = schema.required;
  const property = IsProperties(schema) ? schema.properties[inputProperty] : undefined;

  if (!property) {
    throw new Error(
      `grammar constrained sampling requires a properties entry for ${inputProperty}`,
    );
  }

  if (!IsSchemaObject(property) || !IsType(property) || property.type !== "string") {
    throw new Error(`grammar constrained sampling property ${inputProperty} must have type string`);
  }

  return inputProperty;
}

export function resolveJsonSchemaStrictSampling(
  tool: Tool,
  supportsStrictMode: boolean,
): boolean | undefined {
  const config = tool.constrainedSampling;

  if (!config || config.type !== "json_schema") return undefined;

  if (supportsStrictMode) {
    try {
      makeStrictJsonSchema(tool.parameters);

      return true;
    } catch (error) {
      if (!(error instanceof UnsupportedStrictJsonSchemaError)) throw error;

      if (config.strict !== "require") return undefined;
      throw new Error(
        `Tool "${tool.name}" requires JSON-schema constrained sampling, but ${error.message}.`,
      );
    }
  }

  if (config.strict === "require") {
    throw new Error(
      `Tool "${tool.name}" requires JSON-schema constrained sampling, but strict tools are unsupported.`,
    );
  }

  return undefined;
}

export function resolveGrammarConstrainedSampling(
  tool: Tool,
  supportsOpenAIGrammarTools: boolean,
): GrammarConstrainedSampling | undefined {
  const config = tool.constrainedSampling;

  if (!config || config.type !== "grammar") {
    return undefined;
  }

  if (!supportsOpenAIGrammarTools) {
    return undefined;
  }

  const larkDefinition = config.variants.openai_lark;
  const regexDefinition = config.variants.openai_regex;

  const variant = larkDefinition?.trim()
    ? { format: "lark" as const, definition: larkDefinition }
    : regexDefinition?.trim()
      ? { format: "regex" as const, definition: regexDefinition }
      : undefined;

  if (!variant) {
    throw new Error(
      `Tool "${tool.name}" cannot use grammar constrained sampling: no supported grammar variant was provided.`,
    );
  }

  try {
    return { ...variant, inputProperty: inferGrammarInputProperty(tool) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: ${message}.`);
  }
}

export function createGrammarToolInputProperties(
  tools: Tool[] | undefined,
  supportsOpenAIGrammarTools: boolean,
): ReadonlyMap<string, string> {
  const properties = new Map<string, string>();

  for (const tool of tools ?? []) {
    const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);

    if (grammar) {
      properties.set(tool.name, grammar.inputProperty);
    }
  }

  return properties;
}
