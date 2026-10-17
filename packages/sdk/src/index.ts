import { openHost } from "@nyte-ai/host";
import { connect } from "./connect.ts";

export type { OpenHostOptions } from "@nyte-ai/host";
export { createSendJournal } from "./journal.ts";

export * from "./surface.ts";

export const sdk = { open: openHost, connect };
