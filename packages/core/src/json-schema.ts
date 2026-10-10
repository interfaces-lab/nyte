import { asId } from "@nyte-ai/schema";
import type { Id, Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { TCodec, TCyclic, TSchema, TString } from "typebox";
import { Compile } from "typebox/compile";

/** The JSON value union, its arrays and objects referring back to `Json`: the one definition `withJson` hoists under a root's `$defs`. */
const JSON_DEFINITION = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Type.Ref("Json")),
  Type.Record(Type.String(), Type.Ref("Json")),
]);

/** Validates any JSON value by referring to the `Json` definition; it resolves only beneath a root built with `withJson`. */
export const JsonSchema = Type.Unsafe<Json>(Type.Ref("Json"));

/** Returns a root schema that defines `Json` once under its `$defs`, so every `JsonSchema` beneath it resolves to that one entry and the emitted JSON Schema loads in a standard validator. */
export function withJson<T extends TSchema>(
  schema: T,
): TCyclic<{ Json: typeof JSON_DEFINITION; Root: T }, "Root"> {
  return Type.Cyclic({ Json: JSON_DEFINITION, Root: schema }, "Root");
}

/** Returns a string schema that decodes to an id of `Name` through `asId` and encodes back to the string. */
export function idSchema<Name extends string>(): TCodec<TString, Id<Name>> {
  return Type.Codec(Type.String())
    .Decode((value) => asId<Name>(value))
    .Encode((value) => value);
}

/** Validates a `Usage`: one provider request's token counts and cost. */
export const UsageSchema = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  cacheRead: Type.Number(),
  cacheWrite: Type.Number(),
  reasoning: Type.Union([Type.Number(), Type.Null()]),
  total: Type.Number(),
  cost: Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    total: Type.Number(),
  }),
});

/** Validates a `ToolClass`: what a tool call does. */
export const ToolClassSchema = Type.Union([
  Type.Object({ kind: Type.Literal("read"), path: Type.String() }),
  Type.Object({ kind: Type.Literal("list"), path: Type.String() }),
  Type.Object({ kind: Type.Literal("edit"), path: Type.String() }),
  Type.Object({
    kind: Type.Literal("shell"),
    command: Type.String(),
    description: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("delegate"),
    child: Type.Union([idSchema<"session">(), Type.Null()]),
    role: Type.Union([
      Type.Literal("task"),
      Type.Literal("create"),
      Type.Literal("send"),
      Type.Literal("await"),
      Type.Literal("read"),
      Type.Literal("stop"),
    ]),
    title: Type.Union([Type.String(), Type.Null()]),
  }),
  Type.Object({ kind: Type.Literal("custom"), label: Type.String() }),
]);

/** Validates a `ToolContent`: text or a file. */
export const ToolContentSchema = Type.Union([
  Type.Object({ kind: Type.Literal("text"), text: Type.String() }),
  Type.Object({
    kind: Type.Literal("file"),
    blob: idSchema<"blob">(),
    mime: Type.String(),
    name: Type.Optional(Type.String()),
  }),
]);

/** Validates a `ToolOutcome`: how a tool call settled. Its `output` is `JsonSchema`, so it resolves beneath `withJson`. */
export const ToolOutcomeSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("ok"),
    content: Type.Array(ToolContentSchema),
    output: JsonSchema,
    parts: Type.Array(idSchema<"part">()),
  }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
  Type.Object({ kind: Type.Literal("interrupted") }),
  Type.Object({ kind: Type.Literal("rejected"), reason: Type.String() }),
  Type.Object({ kind: Type.Literal("stopped") }),
]);

/** Validates a `ToolProgress`: a tool's progress report. Its `detail` is `JsonSchema`, so it resolves beneath `withJson`. */
export const ToolProgressSchema = Type.Object({
  text: Type.Optional(Type.String()),
  fraction: Type.Optional(Type.Number()),
  detail: Type.Optional(JsonSchema),
});

const json = Compile(withJson(JsonSchema));

/** Returns whether a value is JSON: what a part's state and a stored record must be. */
export function isJson(value: unknown): value is Json {
  return json.Check(value);
}
