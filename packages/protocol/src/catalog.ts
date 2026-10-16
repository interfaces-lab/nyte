import { convertJsonSchema } from "@nyte-ai/core";
import type { HostView } from "@nyte-ai/schema";
import { declarations } from "./declarations.ts";

export function operations(): HostView["operations"] {
  return Object.entries(declarations).map(([name, row]) => ({
    name,
    kind: row.kind,
    authority: row.authority,
    input: convertJsonSchema(row.input, "input"),
    output: convertJsonSchema(row.output, "input"),
  }));
}
