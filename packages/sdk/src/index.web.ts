import { SdkError } from "@nyte-ai/schema";
import type { Host, OpenOptions } from "@nyte-ai/core";
import { connect } from "./connection/connect.ts";

export { createSendJournal } from "./send/journal.ts";

export * from "./surface.ts";

export const sdk = {
  open: async (_options: OpenOptions): Promise<Host> => {
    throw new SdkError("unavailable", "open needs a Node host.");
  },
  connect,
};
