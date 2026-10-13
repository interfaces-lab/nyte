import { Type, type Static } from "typebox";

const Word = Type.Object({ text: Type.String(), start: Type.Number(), end: Type.Number() });

export const Manifest = Type.Object({
  voice: Type.String(),
  model: Type.String(),
  lines: Type.Array(
    Type.Object({
      id: Type.String(),
      text: Type.String(),
      file: Type.String(),
      duration: Type.Number(),
      words: Type.Array(Word),
    }),
  ),
});

export type Manifest = Static<typeof Manifest>;

export type Word = Static<typeof Word>;
