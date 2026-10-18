import { Compile } from "typebox/compile";
import type { Validator } from "typebox/compile";
import { Guard } from "typebox/guard";
import { OPERATIONS, SdkError } from "@nyte-ai/schema";
import type { Declaration, Json, Schema, ValidationIssue } from "@nyte-ai/schema";
import type {
  ByteName,
  CallName,
  OperationInput,
  OperationName,
  OperationOutput,
} from "./declarations.ts";
import { rawPart } from "./raw-parts.ts";

type Node = { readonly [key: string]: unknown };

type Definitions = Readonly<Record<string, Node>>;

type Path = readonly (string | number)[];

type Plan = Inert | Composite | Choice;

type Inert = { readonly form: "inert" };

type Composite = {
  readonly form: "composite";
  readonly properties: Map<string, Plan> | null;
  rest: Plan | null;
  items: Items | null;
  readonly nulled: string[];
};

type Items = {
  readonly plan: Plan;
  readonly kinds: ReadonlySet<string> | null;
  readonly reads: (value: unknown) => boolean;
};

type Choice = {
  readonly form: "choice";
  readonly members: Candidate[];
  readonly kinded: Map<string, readonly Candidate[]>;
  readonly unkinded: Candidate[];
};

type Candidate = {
  readonly plan: Plan;
  readonly kinds: ReadonlySet<string> | null;
  readonly check: (value: unknown) => boolean;
};

const INERT: Inert = { form: "inert" };

const PRIMITIVE_TYPES = new Set(["string", "number", "integer", "boolean", "null"]);

const VIEW_DEPTH = 2;

const rows: {
  readonly [N in OperationName]: Declaration<OperationInput<N>, OperationOutput<N>>;
} = OPERATIONS;

const plans = new WeakMap<Schema<unknown>, Plan>();

const BYTE_ROWS = {
  "connection.blob": true,
  "files.bytes": true,
  "page.capture": true,
} as const satisfies { readonly [N in ByteName]: true };

/** Whether `name` names a row of the operations table. */
export function namesOperation(name: string): name is OperationName {
  return Object.hasOwn(OPERATIONS, name);
}

/** Whether a row is answered once with JSON: a query, command or receipt. */
export function answersOnce(name: OperationName): name is CallName {
  const { kind } = OPERATIONS[name];

  return kind === "query" || kind === "command" || kind === "receipt";
}

/** Whether a row is a stream of bytes, answered as a raw octet stream. */
export function answersBytes(name: OperationName): name is ByteName {
  return Object.hasOwn(BYTE_ROWS, name);
}

/** Decodes an operation's input strictly: a value failing the row's input schema, or carrying a field the schema does not name, throws `SdkError("invalid")` with its issues. */
export function decodeInput<N extends OperationName>(name: N, value: unknown): OperationInput<N> {
  const schema = rows[name].input;
  const input = validated(schema, value);
  const unknown: Path[] = [];
  collect(plan(schema), value, [], unknown);

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
  return encode(plan(rows[name].output), value) ?? null;
}

export function decodeOutput<N extends OperationName>(name: N, value: unknown): OperationOutput<N> {
  const schema = rows[name].output;
  const result = schema["~standard"].validate(value);

  if (!(result instanceof Promise) && result.issues === undefined) return result.value;

  return validated(schema, known(plan(schema), value, name === "head.watch" ? VIEW_DEPTH : null));
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
    { issues },
  );
}

function plan(schema: Schema<unknown>): Plan {
  const cached = plans.get(schema);

  if (cached !== undefined) return cached;

  const built = compilePlan(
    schema["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
    {},
    new Map(),
  );

  plans.set(schema, built);

  return built;
}

function compilePlan(start: Node, scope: Definitions, memo: Map<Node, Plan>): Plan {
  const resolved = resolve(start, scope);

  if (resolved === null) return INERT;
  const { node, definitions } = resolved;
  const cached = memo.get(node);

  if (cached !== undefined) return cached;

  if (Guard.IsArray(node.anyOf)) {
    const choice: Choice = { form: "choice", members: [], kinded: new Map(), unkinded: [] };
    memo.set(node, choice);

    for (const entry of node.anyOf) {
      const member = readNode(entry);

      if (member === null) continue;
      let validator: Validator | null = null;
      choice.members.push({
        plan: compilePlan(member, definitions, memo),
        kinds: readKinds(member, definitions, new Map()),
        check: (value) => (validator ??= Compile(definitions, member)).Check(value),
      });
    }

    if (choice.members.every((candidate) => candidate.plan === INERT)) {
      memo.set(node, INERT);

      return INERT;
    }

    const kinds = new Set(choice.members.flatMap((candidate) => [...(candidate.kinds ?? [])]));

    for (const kind of kinds)
      choice.kinded.set(
        kind,
        choice.members.filter((candidate) => candidate.kinds?.has(kind) ?? true),
      );
    choice.unkinded.push(...choice.members.filter((candidate) => candidate.kinds === null));

    return choice;
  }

  if (typeof node.type === "string" && PRIMITIVE_TYPES.has(node.type)) {
    memo.set(node, INERT);

    return INERT;
  }

  const declared = readNode(node.properties);
  const properties = declared === null ? null : new Map<string, Plan>();

  const composite: Composite = {
    form: "composite",
    properties,
    rest: null,
    items: null,
    nulled: [],
  };

  memo.set(node, composite);

  for (const [key, property] of Object.entries(declared ?? {})) {
    const child = readNode(property);

    if (child !== null) properties?.set(key, compilePlan(child, definitions, memo));
  }

  const rest = readRest(node);
  composite.rest = rest === null ? null : compilePlan(rest, definitions, memo);
  const items = readNode(node.items);

  if (items !== null) {
    let validator: Validator | null = null;
    composite.items = {
      plan: compilePlan(items, definitions, memo),
      kinds: readKinds(items, definitions, new Map()),
      reads: (value) => (validator ??= Compile(definitions, items)).Check(value),
    };
  }

  for (const key of Guard.IsArray(node.required) ? node.required : []) {
    if (typeof key !== "string" || declared === null || !Object.hasOwn(declared, key)) continue;
    const property = readNode(declared[key]);

    if (property !== null && accepts(property, definitions)) composite.nulled.push(key);
  }

  return composite;
}

function collect(plan: Plan, value: unknown, path: Path, found: Path[]): void {
  if (plan.form === "inert") return;

  if (plan.form === "choice") {
    const member = select(plan, value);

    if (member !== null) collect(member, value, path, found);

    return;
  }

  if (Guard.IsArray(value)) {
    const { items } = plan;

    if (items !== null)
      for (const [index, item] of value.entries())
        collect(items.plan, item, [...path, index], found);

    return;
  }

  if (typeof value !== "object" || value === null) return;

  for (const [key, field] of Object.entries(value)) {
    const known = plan.properties?.get(key) ?? plan.rest;

    if (known === null) found.push([...path, key]);
    else collect(known, field, [...path, key], found);
  }
}

function encode(plan: Plan, value: unknown): Json | undefined {
  if (plan.form === "inert" || value instanceof Uint8Array) return toJson(value);

  if (plan.form === "choice") {
    if (!(value instanceof Map)) {
      const candidates = candidatesFor(plan, readKind(value));
      const [only] = candidates;

      if (candidates.length === 0) return toJson(value);

      if (candidates.length === 1 && only !== undefined) return encode(only.plan, value);
    }

    const json = toJson(value);

    if (json === undefined) return undefined;
    const member = select(plan, json);

    return member === null ? json : encode(member, json);
  }

  if (Guard.IsArray(value) || value instanceof Set) {
    const { items } = plan;

    return items === null
      ? toJson(value)
      : Array.from(value, (item: unknown) => encode(items.plan, item) ?? null);
  }

  if (typeof value !== "object" || value === null) return toJson(value);
  const { properties, rest } = plan;

  if (properties === null && rest === null) return toJson(value);
  const record: { [key: string]: Json } = {};

  const keep = (key: string, item: unknown) => {
    const target = properties?.get(key) ?? rest;
    const json = target === null ? undefined : encode(target, item);

    if (json !== undefined) put(record, key, json);
  };

  if (value instanceof Map) for (const [key, item] of value) keep(String(key), item);
  else if (Guard.IsObjectNotArray(value))
    for (const key of Object.keys(value)) keep(key, value[key]);

  for (const key of plan.nulled) if (!Object.hasOwn(record, key)) put(record, key, null);

  return record;
}

function known(plan: Plan, value: unknown, positional: number | null): unknown {
  if (plan.form === "inert") return value;

  if (plan.form === "choice") {
    const member = select(plan, value);

    return member === null ? value : known(member, value, positional);
  }

  if (Guard.IsArray(value)) {
    const { items } = plan;

    if (items === null) return value;
    const { kinds, reads } = items;
    const keeps = positional !== null && positional >= 0;

    return value.flatMap((item) => {
      const kind = readKind(item);
      const listed = kinds === null || kind === undefined || kinds.has(kind);
      const read = listed ? known(items.plan, item, null) : item;

      if (listed && reads(read)) return [read];
      const raw = rawPart(item);

      if (raw !== null && reads(raw)) return [raw];

      return keeps ? [read] : [];
    });
  }

  const { properties } = plan;

  if (typeof value !== "object" || value === null || properties === null) return value;
  const inner = positional === null ? null : positional - 1;

  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => {
      const property = properties.get(key);

      return [key, property === undefined ? field : known(property, field, inner)];
    }),
  );
}

function select(choice: Choice, value: unknown): Plan | null {
  const candidates = candidatesFor(choice, readKind(value));
  const [only] = candidates;

  if (candidates.length === 1 && only !== undefined) return only.plan;

  return candidates.find((candidate) => candidate.check(value))?.plan ?? null;
}

function candidatesFor(choice: Choice, kind: string | undefined): readonly Candidate[] {
  if (kind === undefined) return choice.members;

  return choice.kinded.get(kind) ?? choice.unkinded;
}

function resolve(
  start: Node,
  scope: Definitions,
): { readonly node: Node; readonly definitions: Definitions } | null {
  let node = start;
  let definitions = scope;

  for (;;) {
    const local = readNode(node.$defs);

    if (local !== null) {
      const merged: Record<string, Node> = Object.assign({}, definitions);

      for (const [key, entry] of Object.entries(local)) {
        const definition = readNode(entry);

        if (definition !== null) merged[key] = definition;
      }

      definitions = merged;
    }

    const ref = node.$ref;

    if (typeof ref !== "string") return { node, definitions };

    if (ref === "Json") return null;
    const target = definitions[ref];

    if (target === undefined) return null;
    node = target;
  }
}

function readKinds(
  start: Node,
  scope: Definitions,
  seen: Map<Node, ReadonlySet<string> | null>,
): ReadonlySet<string> | null {
  const resolved = resolve(start, scope);

  if (resolved === null) return null;
  const { node, definitions } = resolved;

  if (seen.has(node)) return seen.get(node) ?? null;
  seen.set(node, null);

  if (Guard.IsArray(node.anyOf)) {
    const sets = node.anyOf.map((member) => {
      const child = readNode(member);

      return child === null ? null : readKinds(child, definitions, seen);
    });

    const kinds = sets.every((set) => set !== null)
      ? new Set(sets.flatMap((set) => [...(set ?? [])]))
      : null;

    seen.set(node, kinds);

    return kinds;
  }

  const kind = readNode(readNode(node.properties)?.kind);

  if (kind === null) return null;

  const kinds =
    typeof kind.const === "string"
      ? new Set([kind.const])
      : Guard.IsArray(kind.enum) && kind.enum.every((entry) => typeof entry === "string")
        ? new Set(kind.enum)
        : null;

  seen.set(node, kinds);

  return kinds;
}

function accepts(start: Node, scope: Definitions): boolean {
  if (start.$ref === "Json") return true;
  const resolved = resolve(start, scope);

  if (resolved === null) return false;
  const { node, definitions } = resolved;

  if (node.type === "null") return true;

  return (
    Guard.IsArray(node.anyOf) &&
    node.anyOf.some((member) => {
      const child = readNode(member);

      return child !== null && accepts(child, definitions);
    })
  );
}

function readRest(node: Node): Node | null {
  const additional = readNode(node.additionalProperties);

  if (additional !== null) return additional;
  const patterns = readNode(node.patternProperties);

  if (patterns === null) return null;
  const [first] = Object.values(patterns);

  return readNode(first);
}

function toJson(value: unknown): Json | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;

  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (value instanceof Uint8Array)
    return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));

  if (value instanceof Set) return Array.from(value, (item: unknown) => toJson(item) ?? null);

  if (Guard.IsArray(value)) return value.map((item) => toJson(item) ?? null);

  if (typeof value !== "object") return undefined;
  const record: { [key: string]: Json } = {};

  const keep = (key: string, item: unknown) => {
    const json = toJson(item);

    if (json !== undefined) put(record, key, json);
  };

  if (value instanceof Map) for (const [key, item] of value) keep(String(key), item);
  else if (Guard.IsObjectNotArray(value))
    for (const key of Object.keys(value)) keep(key, value[key]);

  return record;
}

function put(record: { [key: string]: Json }, key: string, json: Json): void {
  if (key === "__proto__")
    Object.defineProperty(record, key, {
      value: json,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  else record[key] = json;
}

function readNode(value: unknown): Node | null {
  return Guard.IsObjectNotArray(value) ? value : null;
}

function readKind(value: unknown): string | undefined {
  const kind = Guard.IsObjectNotArray(value) ? value.kind : undefined;

  return typeof kind === "string" ? kind : undefined;
}

function pointer(path: Path): string {
  return path.length === 0 ? "the input" : `/${path.join("/")}`;
}
