import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import type { StaticDecode, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Validator } from "typebox/compile";

/**
 * Accepts any validator that implements both Standard Schema halves.
 *
 * **Details**
 *
 * The SDK never imports a validator. Each half has one job:
 *
 * - `validate`: model tool args, client actions, command args.
 * - `jsonSchema.input`: tool parameters to the model.
 * - `jsonSchema.output`: part state and actions to clients, the catalog.
 *
 * Who implements both halves natively, as of their current releases:
 *
 * - zod 4.2+: every schema, directly.
 * - arktype 2.1.28+: every type, directly.
 * - valibot 1.2+: through `toStandardJsonSchema()` from `@valibot/to-json-schema`.
 * - typebox 1.3.x: **neither half**. `Compile()` returns a `Validator` with
 *   `Check`/`Parse` and no `~standard`. TypeBox schemas are already JSON
 *   Schema, so the adapter is small and lives in `@nyte-ai/schema`:
 *
 * ```ts
 * import { Compile } from "typebox/compile";
 * import type { TSchema, StaticDecode } from "typebox";
 *
 * export function standard<T extends TSchema>(schema: T): Schema<StaticDecode<T>> {
 *   const validator = Compile(schema);
 *   return {
 *     "~standard": {
 *       version: 1,
 *       vendor: "typebox",
 *       validate: (value) =>
 *         validator.Check(value)
 *           ? { value: validator.Parse(value) }
 *           : { issues: validator.Errors(value).map((e) => ({ message: e.message, path: e.path.split("/").filter(Boolean) })) },
 *       jsonSchema: { input: () => schema, output: () => schema },
 *       types: undefined, // phantom; StaticDecode<T> carries the types
 *     },
 *   };
 * }
 * ```
 *
 * Core's own records are written with TypeBox and cross the plugin boundary
 * through `standard()`. A plugin author may use any of the four; the kernel
 * only ever sees `~standard`.
 *
 * **Gotchas**
 *
 * A schema that cannot convert to JSON Schema is a load-time
 * {@link ValidationIssue}, not a runtime failure. `jsonSchema` may throw
 * per the spec; core calls it at plugin load, never at request time.
 *
 * @category schemas
 * @since 0.1.0
 */
export type Schema<T> = StandardSchemaV1<unknown, T> & StandardJSONSchemaV1<unknown, T>;

/**
 * Returns the output type a Standard Schema validates to.
 *
 * @category schemas
 * @since 0.1.0
 */
export type Infer<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

/** Adapts a TypeBox schema to both Standard Schema halves; the JSON Schema is the schema itself, compiled on first validation. Validating is the compiled validator's `Check`; a value that passes is returned as its typed `Decode`, which runs TypeBox's codec pipeline only when the schema holds a codec and is otherwise its `Parse`, the same check (§39e, §40k). */
export function standard<T extends TSchema>(schema: T): Schema<StaticDecode<T>> {
  let validator: Validator<{}, T> | undefined;
  const json: Record<string, unknown> = Object.fromEntries(Object.entries(schema));

  return {
    "~standard": {
      version: 1,
      vendor: "typebox",
      validate: (value) => {
        validator ??= Compile(schema);

        if (validator.Check(value)) return { value: validator.Decode(value) };

        return {
          issues: validator.Errors(value).map((error) => ({
            message: error.message,
            path: error.instancePath.split("/").filter(Boolean),
          })),
        };
      },
      jsonSchema: { input: () => json, output: () => json },
      types: undefined,
    },
  };
}
