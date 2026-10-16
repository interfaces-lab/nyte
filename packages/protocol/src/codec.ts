import { IsSchema } from "typebox";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Validator } from "typebox/compile";
import { OPERATIONS } from "@nyte-ai/schema";
import type { Declaration, Json, Schema, ValidationIssue } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { OperationInput, OperationName, OperationOutput } from "./declarations.ts";
import { isRecord } from "./json.ts";

type Node = { readonly [key: string]: unknown };

type Member = TSchema & Node;

type Definitions = Readonly<Record<string, Member>>;

type Path = readonly (string | number)[];

const rows: {
  readonly [N in OperationName]: Declaration<OperationInput<N>, OperationOutput<N>>;
} = OPERATIONS;

const validators = new WeakMap<object, Validator>();

const kinds = new WeakMap<Node, ReadonlySet<string> | null>();

/** Decodes an operation's input strictly: a value failing the row's input schema, or carrying a field the schema does not name, throws `SdkError("invalid")` with its issues. */
export function decodeInput<N extends OperationName>(name: N, value: unknown): OperationInput<N> {
  const schema = rows[name].input;
  const input = validated(schema, value);
  const unknown = unknownFields(schema, value);

  if (unknown.length > 0)
    throw new SdkError("invalid", `${name} does not take ${unknown.map(pointer).join(", ")}.`, {
      issues: unknown.map((path) => ({ severity: "error", path, message: "Unknown field." })),
    });

  return input;
}

/** Encodes an operation's input as the JSON the wire carries. */
export function encodeInput<N extends OperationName>(_name: N, input: OperationInput<N>): Json {
  return toJson(input) ?? null;
}

/** Encodes an operation's output, or one frame of it, as the JSON the wire carries: `Set`s become arrays, `Map`s objects and bytes base64; fields its schema does not name are stripped; an undefined field is omitted, or null where the schema requires it and accepts null (`part.act`'s output, §40f). */
export function encodeOutput<N extends OperationName>(name: N, value: OperationOutput<N>): Json {
  const json = toJson(value) ?? null;
  const { node, definitions } = rootOf(rows[name].output);

  return strip(node, definitions, json);
}

/** Decodes an operation's output, or one frame of it, leniently: unknown fields are ignored and array records of an unknown kind skipped; a value that still fails throws `SdkError("invalid")`, which a stream reader skips. Wire forms stay wire forms: the sdk rebuilds `Set`s and `Map`s. */
export function decodeOutput<N extends OperationName>(name: N, value: unknown): OperationOutput<N> {
  const schema = rows[name].output;
  const { node, definitions } = rootOf(schema);

  return validated(schema, known(node, definitions, value));
}

/** Returns the paths of every field a value carries that its schema does not name, at every object level: what strict input rejects. The value is read along the union member it validates against. */
export function unknownFields(schema: Schema<unknown>, value: unknown): readonly Path[] {
  const { node, definitions } = rootOf(schema);
  const found: Path[] = [];
  collect(node, definitions, value, [], found);

  return found;
}

function validated<T>(schema: Schema<T>, value: unknown): T {
  const result = schema["~standard"].validate(value);

  if (result instanceof Promise) throw new SdkError("internal", "A wire schema is asynchronous.");

  if (result.issues === undefined) return result.value;

  const issues = result.issues.map((issue): ValidationIssue => ({
    severity: "error",
    path: (issue.path ?? []).map((segment) => {
      const key = typeof segment === "object" ? segment.key : segment;

      return typeof key === "number" ? key : String(key);
    }),
    message: issue.message,
  }));

  throw new SdkError(
    "invalid",
    issues.map((issue) => `${pointer(issue.path)}: ${issue.message}`).join("; "),
    {
      issues,
    },
  );
}

function rootOf(schema: Schema<unknown>): {
  readonly node: Node;
  readonly definitions: Definitions;
} {
  return {
    node: schema["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
    definitions: {},
  };
}

function collect(start: Node, scope: Definitions, value: unknown, path: Path, found: Path[]): void {
  const resolved = resolve(start, scope);

  if (resolved === null) return;
  const { node, definitions } = resolved;
  const members = node.anyOf;

  if (Array.isArray(members)) {
    const member = memberOf(members, definitions, value);

    if (member !== null) collect(member, definitions, value, path, found);

    return;
  }

  if (Array.isArray(value)) {
    if (isNode(node.items))
      for (const [index, item] of value.entries())
        collect(node.items, definitions, item, [...path, index], found);

    return;
  }

  if (typeof value !== "object" || value === null) return;
  const rest = restOf(node);

  for (const [key, field] of Object.entries(value)) {
    const known = propertyOf(node, key);

    if (known !== null) collect(known, definitions, field, [...path, key], found);
    else if (rest !== null) collect(rest, definitions, field, [...path, key], found);
    else found.push([...path, key]);
  }
}

function strip(start: Node, scope: Definitions, value: Json): Json {
  const resolved = resolve(start, scope);

  if (resolved === null) return value;
  const { node, definitions } = resolved;
  const members = node.anyOf;

  if (Array.isArray(members)) {
    const member = memberOf(members, definitions, value);

    return member === null ? value : strip(member, definitions, value);
  }

  const items = node.items;

  if (Array.isArray(value))
    return isNode(items) ? value.map((item) => strip(items, definitions, item)) : value;

  if (!isRecord(value)) return value;
  const rest = restOf(node);

  if (!isNode(node.properties) && rest === null) return value;

  const kept = Object.entries(value).flatMap(([key, field]): [string, Json][] => {
    const known = propertyOf(node, key) ?? rest;

    return known === null ? [] : [[key, strip(known, definitions, field)]];
  });

  const required = Array.isArray(node.required) ? node.required : [];

  const absent = required.flatMap((key): [string, Json][] => {
    if (typeof key !== "string" || Object.hasOwn(value, key)) return [];
    const known = propertyOf(node, key);

    return known !== null && nullable(known, definitions) ? [[key, null]] : [];
  });

  return Object.fromEntries([...kept, ...absent]);
}

function known(start: Node, scope: Definitions, value: unknown): unknown {
  const resolved = resolve(start, scope);

  if (resolved === null) return value;
  const { node, definitions } = resolved;
  const members = node.anyOf;

  if (Array.isArray(members)) {
    const member = memberOf(members, definitions, value);

    return member === null ? value : known(member, definitions, value);
  }

  if (Array.isArray(value)) {
    const items = node.items;

    if (!isNode(items)) return value;
    const kinds = kindsOf(items, definitions);

    return value
      .filter((item) => kinds === null || !isKinded(item) || kinds.has(item.kind))
      .map((item) => known(items, definitions, item));
  }

  if (typeof value !== "object" || value === null || !isNode(node.properties)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => {
      const property = propertyOf(node, key);

      return [key, property === null ? field : known(property, definitions, field)];
    }),
  );
}

function resolve(
  start: Node,
  scope: Definitions,
): { readonly node: Node; readonly definitions: Definitions } | null {
  let node = start;
  let definitions = scope;

  for (;;) {
    if (isNode(node.$defs))
      definitions = {
        ...definitions,
        ...Object.fromEntries(
          Object.entries(node.$defs).flatMap(([key, entry]) =>
            isMember(entry) ? [[key, entry]] : [],
          ),
        ),
      };
    const ref = node.$ref;

    if (typeof ref !== "string") return { node, definitions };

    if (ref === "Json") return null;
    const target = definitions[ref];

    if (target === undefined) return null;
    node = target;
  }
}

function memberOf(
  members: readonly unknown[],
  definitions: Definitions,
  value: unknown,
): Node | null {
  const kind = isKinded(value) ? value.kind : undefined;

  const candidates = members.filter(
    (member): member is Member =>
      isMember(member) && (kind === undefined || (kindsOf(member, definitions)?.has(kind) ?? true)),
  );

  if (candidates.length === 1) return candidates[0] ?? null;

  return candidates.find((member) => validatorOf(member, definitions).Check(value)) ?? null;
}

function kindsOf(start: Node, scope: Definitions): ReadonlySet<string> | null {
  const known = kinds.get(start);

  if (known !== undefined) return known;
  const found = kindsIn(start, scope);
  kinds.set(start, found);

  return found;
}

function kindsIn(start: Node, scope: Definitions): ReadonlySet<string> | null {
  const resolved = resolve(start, scope);

  if (resolved === null) return null;
  const { node, definitions } = resolved;

  if (Array.isArray(node.anyOf)) {
    const sets = node.anyOf.map((member) => (isNode(member) ? kindsOf(member, definitions) : null));

    return sets.every((set) => set !== null)
      ? new Set(sets.flatMap((set) => [...(set ?? [])]))
      : null;
  }

  const kind = isNode(node.properties) ? node.properties.kind : undefined;

  if (!isNode(kind)) return null;

  if (typeof kind.const === "string") return new Set([kind.const]);

  return Array.isArray(kind.enum) && kind.enum.every((entry) => typeof entry === "string")
    ? new Set(kind.enum)
    : null;
}

function validatorOf(member: Member, definitions: Definitions): Validator {
  const known = validators.get(member);

  if (known !== undefined) return known;
  const validator = Compile(definitions, member);
  validators.set(member, validator);

  return validator;
}

function nullable(start: Node, scope: Definitions): boolean {
  if (start.$ref === "Json") return true;
  const resolved = resolve(start, scope);

  if (resolved === null) return false;
  const { node, definitions } = resolved;

  if (node.type === "null") return true;

  return (
    Array.isArray(node.anyOf) &&
    node.anyOf.some((member) => isNode(member) && nullable(member, definitions))
  );
}

function restOf(node: Node): Node | null {
  if (isNode(node.additionalProperties)) return node.additionalProperties;
  const patterns = node.patternProperties;

  if (!isNode(patterns)) return null;
  const [first] = Object.values(patterns);

  return isNode(first) ? first : null;
}

function toJson(value: unknown): Json | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;

  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (value instanceof Uint8Array)
    return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));

  if (value instanceof Set) return [...value].map((item) => toJson(item) ?? null);

  if (value instanceof Map)
    return Object.fromEntries(
      [...value].flatMap(([key, item]) => {
        const json = toJson(item);

        return json === undefined ? [] : [[String(key), json]];
      }),
    );

  if (Array.isArray(value)) return value.map((item) => toJson(item) ?? null);

  if (typeof value !== "object") return undefined;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const json = toJson(item);

      return json === undefined ? [] : [[key, json]];
    }),
  );
}

function propertyOf(node: Node, key: string): Node | null {
  const properties = node.properties;
  const property = isNode(properties) && Object.hasOwn(properties, key) ? properties[key] : null;

  return isNode(property) ? property : null;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMember(value: unknown): value is Member {
  return IsSchema(value) && isNode(value);
}

function isKinded(value: unknown): value is { readonly kind: string } {
  return isNode(value) && typeof value.kind === "string";
}

function pointer(path: Path): string {
  return path.length === 0 ? "the input" : `/${path.join("/")}`;
}
