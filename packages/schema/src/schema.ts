import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { IsCyclic } from "typebox";
import type { StaticDecode, TProperties, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Validator } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { HasCodec, ParseError } from "typebox/value";
import type { Json } from "./json.ts";

export type Schema<T> = StandardSchemaV1<unknown, T> & StandardJSONSchemaV1<unknown, T>;

export type Infer<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

type Frozen<T> = [Json] extends [T]
  ? T
  : T extends string | number | boolean | bigint | symbol | null | undefined | Uint8Array
    ? T
    : { readonly [K in keyof T]: Frozen<T[K]> };

/** The value a TypeBox schema decodes to, read-only all the way down: every concept's TypeScript type is this of its schema. */
export type Decoded<S extends TSchema> = Frozen<StaticDecode<S>>;

function definitions(schema: TSchema): TProperties {
  if (!IsCyclic(schema)) return {};

  return Object.fromEntries(
    Object.entries(schema.$defs).flatMap(([name, definition]) => {
      const plain = Object.fromEntries(Object.entries(definition).filter(([key]) => key !== "$id"));

      return [
        [name, plain],
        [`urn:typebox:root:${name}`, plain],
      ];
    }),
  );
}

export function compile<T extends TSchema>(schema: T): Validator<{}, T> {
  return Compile<{}, T>(definitions(schema), schema);
}

function issues(errors: TLocalizedValidationError[]): StandardSchemaV1.FailureResult {
  return {
    issues: errors.map((error) => ({
      message: error.message,
      path: error.instancePath.split("/").filter(Boolean),
    })),
  };
}

export function standard<T extends TSchema>(schema: T): Schema<StaticDecode<T>> {
  let validator: Validator<{}, T> | undefined;
  let codec = false;
  const json: Record<string, unknown> = Object.fromEntries(Object.entries(schema));

  return {
    "~standard": {
      version: 1,
      vendor: "typebox",
      validate: (value) => {
        if (!validator) {
          validator = compile(schema);
          codec = HasCodec(validator.Context(), schema);
        }

        if (codec) {
          return validator.Check(value)
            ? { value: validator.Decode(value) }
            : issues(validator.Errors(value));
        }

        try {
          return { value: validator.Decode(value) };
        } catch (error) {
          if (error instanceof ParseError) return issues(error.cause.errors);
          throw error;
        }
      },
      jsonSchema: {
        input: () => json,
        output() {
          if (HasCodec(definitions(schema), schema))
            throw new TypeError("A TypeBox codec does not declare its decoded output JSON Schema.");

          return json;
        },
      },
      types: undefined,
    },
  };
}
