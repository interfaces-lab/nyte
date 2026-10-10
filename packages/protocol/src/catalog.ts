import type { HostView } from "@nyte-ai/schema";

/** Returns the declaration table as `HostView.operations`: each row's name, kind, authority and input and output JSON Schemas, for a client that is not TypeScript. */
export function operations(): HostView["operations"] {
  throw new Error("not implemented");
}
