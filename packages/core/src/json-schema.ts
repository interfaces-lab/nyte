import { compile, isJson } from "@nyte-ai/schema";
import type { JsonSchema, Schema, ValidationIssue } from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import { isJsonObject } from "./records.ts";

const schemas = new WeakMap<
  Schema<unknown>,
  { readonly input?: JsonSchema; readonly output?: JsonSchema }
>();

export function convertJsonSchema(
  schema: Schema<unknown>,
  direction: "input" | "output",
): JsonSchema {
  const cached = schemas.get(schema) ?? {};
  const known = cached[direction];

  if (known !== undefined) return known;
  const result = schema["~standard"].jsonSchema[direction]({ target: "draft-2020-12" });

  if (!isJson(result) || !isJsonObject(result))
    throw new SdkError("invalid", `The schema's ${direction} JSON Schema is not a JSON object.`);

  schemas.set(
    schema,
    direction === "input" ? { ...cached, input: result } : { ...cached, output: result },
  );

  return result;
}

const outputs = new WeakMap<Schema<unknown>, (value: unknown) => boolean>();

export function matchesOutput<T>(schema: Schema<T>, value: unknown): value is T {
  const known = outputs.get(schema);

  if (known !== undefined) return known(value);
  const validator = compile(convertJsonSchema(schema, "output"));
  const matches = (value: unknown): boolean => validator.Check(value);
  outputs.set(schema, matches);

  return matches(value);
}

export type Checked<T> =
  | { readonly kind: "valid"; readonly value: T }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] };

export async function check<T>(schema: Schema<T>, value: unknown): Promise<Checked<T>> {
  const result = await schema["~standard"].validate(value);

  if (result.issues === undefined) return { kind: "valid", value: result.value };

  return {
    kind: "invalid",
    issues: result.issues.map((found) => ({
      severity: "error",
      path: (found.path ?? []).map((segment) => {
        const key = typeof segment === "object" ? segment.key : segment;

        return typeof key === "symbol" ? String(key) : key;
      }),
      message: found.message,
    })),
  };
}
