import { connect } from "./connect.ts";

export { createSendJournal } from "./journal.ts";

export * from "./surface.ts";

/**
 * The SDK for a client of a host in another process: `connect` without `open`, so
 * importing it never loads the host, its models or its store.
 */
export const sdk = { connect };
