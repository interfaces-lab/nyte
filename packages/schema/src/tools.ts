import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import type { PartId } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const ToolClassType = Type.Union([
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
    child: nullable(idSchema<"session">()),
    role: Type.Enum(["task", "create", "send", "await", "read", "stop"]),
    title: nullable(Type.String()),
  }),
  Type.Object({ kind: Type.Literal("custom"), label: Type.String() }),
]);

export type ToolClass = Decoded<typeof ToolClassType>;

export const ToolContentType = Type.Union([
  Type.Object({ kind: Type.Literal("text"), text: Type.String() }),
  Type.Object({
    kind: Type.Literal("file"),
    blob: idSchema<"blob">(),
    mime: Type.String(),
    name: Type.Optional(Type.String()),
  }),
]);

export type ToolContent = Decoded<typeof ToolContentType>;

export const ToolOutcomeType = Type.Union([
  Type.Object({
    kind: Type.Literal("ok"),
    content: Type.Array(ToolContentType),
    output: JsonType,
    parts: Type.Array(idSchema<"part">()),
  }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
  Type.Object({ kind: Type.Literal("interrupted") }),
  Type.Object({ kind: Type.Literal("rejected"), reason: Type.String() }),
  Type.Object({ kind: Type.Literal("stopped") }),
]);

export type ToolOutcome = Decoded<typeof ToolOutcomeType>;

export const ToolProgressType = Type.Object({
  text: Type.Optional(Type.String()),
  fraction: Type.Optional(Type.Number()),
  detail: Type.Optional(JsonType),
});

export type ToolProgress = Decoded<typeof ToolProgressType>;

export const ToolClassSchema: Schema<ToolClass> = standard(ToolClassType);

export const ToolContentSchema: Schema<ToolContent> = standard(ToolContentType);

export const ToolOutcomeSchema: Schema<ToolOutcome> = standard(withJson(ToolOutcomeType));

export const ToolProgressSchema: Schema<ToolProgress> = standard(withJson(ToolProgressType));

export type ToolResult<Output> = {
  readonly content: readonly ToolContent[];
  readonly output?: Output;
  readonly parts?: readonly PartId[];
};
