import type { HostView, JsonSchema } from "@nyte-ai/schema";
import { declarations } from "./declarations.ts";
import { isRecord, parseJson } from "./json.ts";

const TARGET = { target: "draft-2020-12" } as const;

/** Returns the declaration table as `HostView.operations`: each row's name, kind, authority and input and output JSON Schemas, for a client that is not TypeScript. */
export function operations(): HostView["operations"] {
  return Object.entries(declarations).map(([name, row]) => ({
    name,
    kind: row.kind,
    authority: row.authority,
    input: documentOf(row.input["~standard"].jsonSchema.input(TARGET)),
    output: documentOf(row.output["~standard"].jsonSchema.output(TARGET)),
  }));
}

function documentOf(schema: Record<string, unknown>): JsonSchema {
  const document = parseJson(JSON.stringify(schema));

  return isRecord(document) ? document : {};
}
