/**
 * Strict argument parsing for the built-in tools. The loop validates against
 * the same schema afterwards but coerces primitives ("5" to 5); running this
 * first rejects such arguments outright and drops keys the schema does not
 * name, so an effect intent records exactly the model's typed input.
 */
import type { Static, TObject } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";

export function argumentParser<S extends TObject>(schema: S): (args: unknown) => Static<S> {
  const validator = Compile(schema);
  return (args) => {
    const cleaned = Value.Clean(schema, Value.Clone(args));
    if (validator.Check(cleaned)) return cleaned;
    const [first] = validator.Errors(cleaned);
    const field =
      first === undefined || first.instancePath === ""
        ? ""
        : `${first.instancePath.slice(1).replaceAll("/", ".")} `;
    throw new Error(`Invalid arguments: ${field}${first?.message ?? "must be object"}`);
  };
}
