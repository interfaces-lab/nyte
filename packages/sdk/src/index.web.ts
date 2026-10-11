import { SdkError } from "@nyte-ai/core";
import type { Host, OpenOptions } from "@nyte-ai/core";
import { connect } from "./connect.ts";

export { memoryJournal } from "./journal.ts";

export * from "./surface.ts";

/**
 * Returns the SDK root for a browser or React Native: `connect` as on Node,
 * and an `open` that rejects `unavailable`, since composing a host needs
 * Node. Its `open` takes core's `OpenOptions` (Node's takes `OpenHostOptions`),
 * so nothing here names `@nyte-ai/host`, not even a type, and the entry
 * compiles under the DOM lib without Node's types.
 */
export const sdk = {
  open: async (_options: OpenOptions): Promise<Host> => {
    throw new SdkError("unavailable", "open needs a Node host.");
  },
  connect,
};
