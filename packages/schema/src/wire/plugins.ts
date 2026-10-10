import { Type } from "typebox";

/** The TypeBox schema of a `PromptOverride`. */
export const PromptOverrideType = Type.Union([
  Type.Object({
    kind: Type.Literal("layer"),
    text: Type.String(),
    order: Type.Optional(Type.Number()),
  }),
  Type.Object({ kind: Type.Literal("replace"), text: Type.String() }),
]);
