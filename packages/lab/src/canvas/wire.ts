import { Type, type Static } from "typebox";

export const CanvasInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 160 }),
    source: Type.String({ minLength: 1, maxLength: 100_000 }),
  },
  { additionalProperties: false },
);

export const CanvasSnapshotSchema = Type.Object({
  id: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  title: Type.String(),
  code: Type.String(),
  runtime: Type.Literal(1),
});

export type CanvasSnapshot = Static<typeof CanvasSnapshotSchema>;
