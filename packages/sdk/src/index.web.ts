import { SdkError } from "@nyte-ai/core";
import type { Host, OpenOptions } from "@nyte-ai/core";
import { connect } from "./connect.ts";

export { createSendJournal } from "./journal.ts";

export * from "./surface.ts";

export const sdk = {
  open: async (_options: OpenOptions): Promise<Host> => {
    throw new SdkError("unavailable", "open needs a Node host.");
  },
  connect,
};
