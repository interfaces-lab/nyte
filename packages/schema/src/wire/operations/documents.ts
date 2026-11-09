import { Type } from "typebox";
import { DocumentSchema, FileEventType, WriteOutcomeSchema } from "../../files.ts";
import { idSchema } from "../../ids.ts";
import { BYTES, wireObject, wireSchema } from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const DOCUMENTS = { authority: "owner", scope: "host" } as const;

const PATH = { path: Type.String() };

export const DOCUMENT_OPERATIONS = {
  "documents.read": {
    ...DOCUMENTS,
    summary: "Reads a file at an absolute path as text or as a document with its version.",
    kind: "query",
    input: wireObject({
      ...PATH,
      options: Type.Optional(Type.Object({ as: Type.Optional(Type.Enum(["text", "document"])) })),
    }),
    output: DocumentSchema,
  },
  "documents.bytes": {
    ...DOCUMENTS,
    summary: "Streams the bytes of a file at an absolute path.",
    kind: "stream",
    input: wireObject(PATH),
    output: BYTES,
  },
  "documents.write": {
    ...DOCUMENTS,
    summary:
      "Writes the request body to a file at an absolute path, optionally only if it still has the expected version.",
    kind: "command",
    input: wireObject({
      ...PATH,
      options: Type.Optional(
        Type.Object({
          expect: Type.Optional(Type.Union([Type.Literal("absent"), idSchema<"file-version">()])),
          parents: Type.Optional(Type.Boolean()),
        }),
      ),
    }),
    output: WriteOutcomeSchema,
  },
  "documents.watch": {
    ...DOCUMENTS,
    summary: "Streams changes to files at absolute paths as they happen.",
    kind: "watch",
    input: wireObject({ paths: Type.Array(Type.String()) }),
    output: wireSchema(Type.Array(FileEventType)),
  },
} as const satisfies OperationRows;
