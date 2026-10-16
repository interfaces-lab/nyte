import { Type } from "typebox";
import {
  FileDocumentSchema,
  FileEntryViewType,
  FileEventType,
  FormatOutcomeSchema,
  ScanFrameSchema,
  SearchFrameSchema,
  WriteOutcomeSchema,
} from "../files.ts";
import { BlobIdSchema, idSchema } from "../ids.ts";
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
  "files.read": { ...FILES, kind: "query", input: ON_PATH, output: FileDocumentSchema },
  "files.bytes": { ...FILES, kind: "stream", input: ON_PATH, output: BYTES },
  "files.stat": {
    ...FILES,
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
    kind: "command",
    input: wireObject({
      ...PATH,
      options: Type.Optional(Type.Object({ expect: Type.Optional(idSchema<"file-version">()) })),
    }),
    output: WriteOutcomeSchema,
  },
  "files.batch": {
    ...FILES,
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
    kind: "query",
    input: wireObject({ ...PATH, contents: Type.String() }),
    output: FormatOutcomeSchema,
  },
  "files.scan": {
    ...FILES,
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
    kind: "query",
    input: QUERY_INPUT,
    output: wireSchema(Type.Array(FileEntryViewType)),
  },
  "files.search": { ...FILES, kind: "stream", input: QUERY_INPUT, output: SearchFrameSchema },
  "files.watch": {
    ...FILES,
    kind: "watch",
    input: wireObject({
      ...WORKSPACE,
      paths: Type.Optional(Type.Array(Type.String())),
    }),
    output: wireSchema(Type.Array(FileEventType)),
  },
  "files.upload": { ...FILES, kind: "command", input: ON_WORKSPACE, output: BlobIdSchema },
} as const satisfies OperationRows;
