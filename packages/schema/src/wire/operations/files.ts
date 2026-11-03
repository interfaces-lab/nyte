import { Type } from "typebox";
import {
  FileDocumentSchema,
  FileEntryViewType,
  FileEventType,
  FormatOutcomeSchema,
  ScanFrameSchema,
  SearchFrameSchema,
  SearchInputType,
  WriteOutcomeSchema,
} from "../../files.ts";
import { BlobIdSchema, idSchema } from "../../ids.ts";
import { nullable } from "../nullable.ts";
import {
  BYTES,
  ON_PATH,
  ON_WORKSPACE,
  PATH,
  RECEIPT_ID,
  wireObject,
  wireSchema,
  WORKSPACE,
} from "./fields.ts";
import type { OperationRows } from "./fields.ts";

const FILES = { authority: "participant", scope: "workspace", capability: "files" } as const;

const QUERY_INPUT = wireObject({
  ...WORKSPACE,
  query: Type.String(),
  limit: Type.Optional(Type.Number()),
});

export const FILE_OPERATIONS = {
  "files.read": {
    ...FILES,
    mcp: "read",
    summary: "Reads a file as text or as a document with its version.",
    kind: "query",
    input: wireObject({
      ...PATH,
      options: Type.Optional(Type.Object({ as: Type.Enum(["text", "document"]) })),
    }),
    output: FileDocumentSchema,
  },
  "files.bytes": {
    ...FILES,
    summary: "Streams the bytes of a file.",
    kind: "stream",
    input: ON_PATH,
    output: BYTES,
  },
  "files.stat": {
    ...FILES,
    mcp: "read",
    summary: "Returns a path's kind, size and version, or null if nothing is there.",
    kind: "query",
    input: ON_PATH,
    output: wireSchema(
      nullable(
        Type.Object({
          kind: Type.Enum(["file", "directory", "symlink"]),
          size: Type.Number(),
          version: idSchema<"file-version">(),
          target: Type.Optional(Type.String()),
        }),
      ),
    ),
  },
  "files.write": {
    ...FILES,
    summary: "Writes a file, optionally only if it still has the expected version.",
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
  "files.remove": {
    ...FILES,
    summary: "Removes a file, optionally only if it still has the expected version.",
    kind: "command",
    input: wireObject({
      ...PATH,
      options: Type.Optional(Type.Object({ expect: Type.Optional(idSchema<"file-version">()) })),
    }),
    output: WriteOutcomeSchema,
  },
  "files.batch": {
    ...FILES,
    summary: "Writes and removes several files together under one receipt.",
    kind: "receipt",
    recovery: "replay",
    input: wireObject({
      ...WORKSPACE,
      id: Type.Optional(idSchema<"receipt">()),
      entries: Type.Array(
        Type.Union([
          Type.Object({
            kind: Type.Literal("put"),
            path: Type.String(),
            contents: Type.Union([Type.String(), Type.Object({ blob: idSchema<"blob">() })]),
            expect: Type.Optional(Type.Union([Type.Literal("absent"), idSchema<"file-version">()])),
          }),
          Type.Object({
            kind: Type.Literal("remove"),
            path: Type.String(),
            expect: Type.Optional(idSchema<"file-version">()),
          }),
        ]),
      ),
    }),
    output: RECEIPT_ID,
  },
  "files.format": {
    ...FILES,
    summary: "Returns the given contents formatted for the file at that path, without writing it.",
    kind: "query",
    input: wireObject({ ...PATH, contents: Type.String() }),
    output: FormatOutcomeSchema,
  },
  "files.scan": {
    ...FILES,
    summary: "Streams the files and folders under a directory.",
    kind: "stream",
    input: wireObject({
      ...WORKSPACE,
      directory: Type.Optional(Type.String()),
      ignored: Type.Optional(Type.Enum(["exclude", "include"])),
    }),
    output: ScanFrameSchema,
  },
  "files.find": {
    ...FILES,
    mcp: "read",
    summary: "Lists the files whose paths best match a query, best first.",
    kind: "query",
    input: QUERY_INPUT,
    output: wireSchema(Type.Array(FileEntryViewType)),
  },
  "files.search": {
    ...FILES,
    summary: "Streams matches for a text search across the workspace's files.",
    kind: "stream",
    input: wireObject({ ...WORKSPACE, ...SearchInputType.properties }),
    output: SearchFrameSchema,
  },
  "files.watch": {
    ...FILES,
    summary: "Streams file changes in the workspace as they happen.",
    kind: "watch",
    input: wireObject({
      ...WORKSPACE,
      paths: Type.Optional(Type.Array(Type.String())),
    }),
    output: wireSchema(Type.Array(FileEventType)),
  },
  "files.upload": {
    ...FILES,
    summary: "Uploads the request body and returns a blob id to use in a batch.",
    kind: "command",
    input: ON_WORKSPACE,
    output: BlobIdSchema,
  },
} as const satisfies OperationRows;
