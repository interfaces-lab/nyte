import { Type } from "typebox";
import type { Static } from "typebox";
import { STRUCTURE_PROFILES } from "./file-structure-profiles.ts";

const line = Type.Integer({ minimum: 1 });

const span = Type.Object({ startLine: line, endLine: line });

const identity = {
  generation: Type.Integer({ minimum: 1 }),
  language: Type.Enum(STRUCTURE_PROFILES.map((profile) => profile.language)),
  contents: Type.String(),
};

export const structureRequest = Type.Object(identity);

export type StructureRequest = Static<typeof structureRequest>;

export const structureResponse = Type.Union([
  Type.Object({
    kind: Type.Literal("ready"),
    ...identity,
    folds: Type.Array(
      Type.Object({
        headerLine: line,
        range: span,
        hidden: span,
        kind: Type.Union([
          Type.Literal("code"),
          Type.Literal("comment"),
          Type.Literal("section"),
          Type.Literal("literal"),
        ]),
      }),
    ),
    symbols: Type.Array(
      Type.Object({
        name: Type.String(),
        kind: Type.Union([
          Type.Literal("function"),
          Type.Literal("class"),
          Type.Literal("type"),
          Type.Literal("variable"),
          Type.Literal("heading"),
        ]),
        line,
        endLine: line,
        depth: Type.Integer({ minimum: 0 }),
      }),
    ),
  }),
  Type.Object({ kind: Type.Literal("error"), ...identity, error: Type.String() }),
]);

export type StructureResponse = Static<typeof structureResponse>;
