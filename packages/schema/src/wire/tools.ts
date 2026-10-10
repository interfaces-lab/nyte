import { Type } from "typebox";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import type { ToolClass, ToolContent, ToolOutcome, ToolProgress } from "../tools.ts";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { nullable } from "./nullable.ts";

/** The TypeBox schema of a `ToolClass`. */
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

/** The TypeBox schema of a `ToolContent`. */
export const ToolContentType = Type.Union([
  Type.Object({ kind: Type.Literal("text"), text: Type.String() }),
  Type.Object({
    kind: Type.Literal("file"),
    blob: idSchema<"blob">(),
    mime: Type.String(),
    name: Type.Optional(Type.String()),
  }),
]);

/** The TypeBox schema of a `ToolOutcome`. */
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

/** The TypeBox schema of a `ToolProgress`. */
export const ToolProgressType = Type.Object({
  text: Type.Optional(Type.String()),
  fraction: Type.Optional(Type.Number()),
  detail: Type.Optional(JsonType),
});

/** Validates a `ToolClass`. */
export const ToolClassSchema: Schema<ToolClass> = standard(ToolClassType);

/** Validates a `ToolContent`. */
export const ToolContentSchema: Schema<ToolContent> = standard(ToolContentType);

/** Validates a `ToolOutcome`. */
export const ToolOutcomeSchema: Schema<ToolOutcome> = standard(withJson(ToolOutcomeType));

/** Validates a `ToolProgress`. */
export const ToolProgressSchema: Schema<ToolProgress> = standard(withJson(ToolProgressType));
