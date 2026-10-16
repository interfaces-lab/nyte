import { Type } from "typebox";
import type { PromptOverride } from "../plugins.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";

export const PromptOverrideType = Type.Union([
  Type.Object({
    kind: Type.Literal("layer"),
    text: Type.String(),
    order: Type.Optional(Type.Number()),
  }),
  Type.Object({ kind: Type.Literal("replace"), text: Type.String() }),
]);

export const PromptOverrideSchema: Schema<PromptOverride> = standard(PromptOverrideType);
