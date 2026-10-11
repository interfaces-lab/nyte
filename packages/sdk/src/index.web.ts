import { SdkError } from "@nyte-ai/core";
import type { Host } from "@nyte-ai/core";
import type { OpenHostOptions } from "@nyte-ai/host";
import { connect } from "./connect.ts";

export type { OpenHostOptions } from "@nyte-ai/host";
export { memoryJournal } from "./journal.ts";

export * from "./surface.ts";

/**
 * Returns the SDK root for a browser or React Native: `connect` as on Node,
 * and an `open` that rejects `unavailable`, since composing a host needs
 * Node. Imports no `node:*` and nothing from `@nyte-ai/host` at runtime
 * (its `OpenHostOptions` is a type, erased).
 */
export const sdk = {
  open: async (_options: OpenHostOptions): Promise<Host> => {
    throw new SdkError("unavailable", "open needs a Node host.");
  },
  connect,
};
