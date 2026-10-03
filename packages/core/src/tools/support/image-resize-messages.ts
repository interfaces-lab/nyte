/**
 * Messages between `resizeImage` and `image-resize-worker`. Both ends parse
 * what they receive with these checks and branch on the typed result.
 */
import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";

const BytesSchema = Type.Refine(
  Type.Unsafe<Uint8Array>({}),
  (value) => value instanceof Uint8Array,
);

const RequestSchema = Type.Object({
  inputBytes: BytesSchema,
  mimeType: Type.String(),
  options: Type.Optional(
    Type.Object({
      maxWidth: Type.Optional(Type.Number()),
      maxHeight: Type.Optional(Type.Number()),
      maxBytes: Type.Optional(Type.Number()),
      jpegQuality: Type.Optional(Type.Number()),
    }),
  ),
});

const ResizedImageSchema = Type.Object({
  data: Type.String(),
  mimeType: Type.String(),
  originalWidth: Type.Number(),
  originalHeight: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
  wasResized: Type.Boolean(),
});

const ResponseSchema = Type.Union([
  Type.Object({ error: Type.String() }),
  Type.Object({ result: Type.Union([ResizedImageSchema, Type.Null()]) }),
]);

export type ResizeRequest = Static<typeof RequestSchema>;

export type ResizeResponse = Static<typeof ResponseSchema>;

export const checkResizeRequest = Compile(RequestSchema);

export const checkResizeResponse = Compile(ResponseSchema);
