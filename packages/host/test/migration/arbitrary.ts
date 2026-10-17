import fc from "fast-check";
import { compile, isJson, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import type { TSchema } from "typebox";

type JsonObject = { readonly [key: string]: Json };

/** Ids drawn from a small pool, so generated records share sessions, runs, calls and parts often enough to meet each other. */
export const ID = fc.constantFrom("a", "b", "c", "d");

const STRING = fc.oneof(ID, fc.string({ maxLength: 6 }));

const NUMBER = fc.oneof(
  fc.integer({ min: 0, max: 2_000_000_000_000 }),
  fc.integer({ min: -1_000, max: 1_000 }),
  fc
    .double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true })
    .filter((value) => !Object.is(value, -0)),
);

/** Reads a TypeBox schema as the JSON Schema it serializes to. */
function jsonSchema(schema: TSchema): JsonObject {
  const value: unknown = JSON.parse(JSON.stringify(schema));

  if (!isJson(value) || !isJsonObject(value))
    throw new TypeError("A schema serializes to an object.");

  return value;
}

function definitions(root: JsonObject): ReadonlyMap<string, JsonObject> {
  const found = new Map<string, JsonObject>();

  const visit = (node: Json): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);

      return;
    }

    if (!isJsonObject(node)) return;

    if (typeof node.$id === "string") found.set(node.$id, node);
    const defs = node.$defs;

    if (isJsonObject(defs))
      for (const [name, definition] of Object.entries(defs))
        if (isJsonObject(definition)) found.set(name, definition);

    for (const child of Object.values(node)) visit(child);
  };

  visit(root);

  return found;
}

function members(node: JsonObject, key: string): readonly JsonObject[] {
  const list = node[key];

  return Array.isArray(list) ? list.filter(isJsonObject) : [];
}

function strings(node: Json | undefined): readonly string[] {
  return Array.isArray(node)
    ? node.flatMap((item) => (typeof item === "string" ? [item] : []))
    : [];
}

/**
 * Generates JSON that a TypeBox schema describes, walking the JSON Schema it
 * serializes to (`$ref`, `anyOf`, `allOf`, `const`, `enum`, objects with
 * required and optional properties, `patternProperties` records, arrays and
 * scalars); `$ref` recursion stops at `depth`, where `Json` becomes null. Every
 * value is checked against the compiled schema, so a keyword this walk does
 * not read can only discard a value, never let an invalid one through.
 */
export function schemaArbitrary(schema: TSchema, depth = 3): fc.Arbitrary<Json> {
  const root = jsonSchema(schema);
  const defs = definitions(root);
  const validator = compile(schema);

  const walk = (node: JsonObject, left: number): fc.Arbitrary<Json> => {
    const ref = node.$ref;

    if (typeof ref === "string") {
      if (ref === "Json" && left <= 0) return fc.constant(null);

      if (left < -8) throw new TypeError(`$ref ${ref} recurses past every bound.`);
      const target = defs.get(ref);

      if (target === undefined) throw new TypeError(`No definition for $ref ${ref}.`);

      return walk(target, left - 1);
    }

    if ("const" in node) return fc.constant(node.const ?? null);

    if (Array.isArray(node.enum)) return fc.constantFrom(...node.enum);
    const anyOf = members(node, "anyOf");

    if (anyOf.length > 0) {
      const shallow =
        left > 0 ? [] : anyOf.filter((member) => !JSON.stringify(member).includes("$ref"));

      return fc.oneof(
        ...(shallow.length > 0 ? shallow : anyOf).map((member) => walk(member, left)),
      );
    }

    const allOf = members(node, "allOf");

    if (allOf.length > 0)
      return walk(
        {
          type: "object",
          properties: Object.fromEntries(
            allOf.flatMap((member) =>
              isJsonObject(member.properties) ? Object.entries(member.properties) : [],
            ),
          ),
          required: allOf.flatMap((member) => strings(member.required)),
        },
        left,
      );

    switch (node.type) {
      case "null":
        return fc.constant(null);
      case "boolean":
        return fc.boolean();
      case "string":
        return STRING;
      case "integer":
        return fc.integer({
          min: typeof node.minimum === "number" ? node.minimum : -1_000,
          max: 1_000_000,
        });
      case "number":
        return NUMBER;
      case "array":
        return left > 0 && isJsonObject(node.items)
          ? fc.array(walk(node.items, left), { maxLength: 3 })
          : fc.constant([]);
      case "object": {
        const properties = isJsonObject(node.properties) ? node.properties : {};
        const required = strings(node.required);

        const patterns = isJsonObject(node.patternProperties)
          ? Object.values(node.patternProperties).filter(isJsonObject)
          : [];

        if (patterns.length > 0 && Object.keys(properties).length === 0)
          return fc.dictionary(STRING, fc.oneof(...patterns.map((item) => walk(item, left))), {
            maxKeys: left > 0 ? 3 : 1,
          });

        return fc.record(
          Object.fromEntries(
            Object.entries(properties).flatMap(([key, value]) =>
              isJsonObject(value) ? [[key, walk(value, left)]] : [],
            ),
          ),
          { requiredKeys: required.filter((key) => key in properties) },
        );
      }

      default:
        throw new TypeError(`No arbitrary for schema ${JSON.stringify(node).slice(0, 120)}.`);
    }
  };

  return walk(root, depth).filter((value) => validator.Check(value));
}
