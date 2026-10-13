import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { IsCyclic } from "typebox";
import type { StaticDecode, TProperties, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Validator } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { HasCodec, ParseError } from "typebox/value";

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

/** Returns a cyclic schema's `$defs` as a compile context, each definition without its `$id` and under both its name and the canonical `urn:typebox:root:<name>` the engine looks up; an `$id` on a definition makes the dynamic checker re-anchor the whole subtree on every reference, and a miss on the canonical key makes it walk the root instead. */
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

/**
 * Compiles a TypeBox schema with its own `$defs` as the compile context.
 *
 * Where code generation is blocked (the desktop renderer's CSP, the web app, the Cloudflare worker)
 * TypeBox falls back to its dynamic checker, which resolves every `$ref` by searching the whole schema
 * tree unless the context already names the target. Schemas built with `withJson`/`Cyclic` reference
 * their `$defs` by name on every nested `Json` value, so an empty context costs an order of magnitude per
 * frame.
 */
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

/** Adapts a TypeBox schema to both Standard Schema halves; the JSON Schema is the schema itself, compiled on first validation. A schema without a codec validates once: its `Decode` is `Parse`, whose failure carries the errors. A schema with a codec is checked first, because its `Decode` pipeline converts the value before asserting it (§39e, §40k). */
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
      jsonSchema: { input: () => json, output: () => json },
      types: undefined,
    },
  };
}
