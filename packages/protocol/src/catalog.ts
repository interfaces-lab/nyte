import { convertJsonSchema } from "@nyte-ai/core";
import { OPERATIONS } from "@nyte-ai/schema";
import type { HostView } from "@nyte-ai/schema";

export function operations(): HostView["operations"] {
  return Object.entries(OPERATIONS).map(([name, row]) => ({
    name,
    kind: row.kind,
    authority: row.authority,
    input: convertJsonSchema(row.input, "input"),
    output: convertJsonSchema(row.output, "input"),
  }));
}
